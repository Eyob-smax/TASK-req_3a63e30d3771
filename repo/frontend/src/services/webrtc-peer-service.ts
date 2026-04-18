// REQ: R19 — WebRTC DataChannels for LAN peer-to-peer collaboration
// REQ: R2 — Manual pairing without signaling server (offer/answer copy-paste)
// Manages RTCPeerConnection lifecycle, DataChannel messaging, and offer/answer encoding.

import { DATA_CHANNEL_LABEL } from '@/models/constants'
import type { CollabMessage, PeerDescriptor } from '@/models/collaboration'
import { encodePairingPayload, decodePairingPayload, verifyPairingChecksum } from '@/serializers/pairing-codec'
import { generateId, generateVerificationCode } from '@/utils/id-generator'
import { logger } from '@/utils/logger'

type CollabMessageHandler = (peerId: string, msg: CollabMessage) => void

interface PeerEntry {
  peerId: string
  connection: RTCPeerConnection
  dataChannel: RTCDataChannel | null
  descriptor: PeerDescriptor
}

const peers = new Map<string, PeerEntry>()
const messageHandlers: Set<CollabMessageHandler> = new Set()

function nowISO(): string {
  return new Date().toISOString()
}

function makePeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [] })
}

/**
 * Create a WebRTC offer as the initiating peer.
 * Returns a base64-encoded offer string for manual copy/paste exchange.
 * SDP ICE gathering is simulated synchronously for the manual pairing model
 * (real ICE candidates require waiting for onicecandidate events).
 */
export async function createOffer(
  roomId: string,
  localPeerId: string,
  localDisplayName: string
): Promise<string> {
  const pc = makePeerConnection()
  const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true })

  dc.onmessage = (event) => handleInboundMessage(localPeerId, event)

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // Wait briefly for ICE gathering to collect local candidates
  await waitForIceGathering(pc)

  const verificationCode = generateVerificationCode()
  const sdp = pc.localDescription?.sdp ?? offer.sdp ?? ''

  const encoded = await encodePairingPayload({
    version: 1,
    type: 'offer',
    roomId,
    peerId: localPeerId,
    displayName: localDisplayName,
    timestamp: nowISO(),
    verificationCode,
    sdp,
    iceCandidates: [],
  })

  const entry: PeerEntry = {
    peerId: localPeerId,
    connection: pc,
    dataChannel: dc,
    descriptor: {
      peerId: localPeerId,
      displayName: localDisplayName,
      roomId,
      connectionState: pc.connectionState,
      dataChannelState: dc.readyState,
      connectedAt: nowISO(),
      lastMessageAt: null,
    },
  }
  peers.set(localPeerId, entry)

  dc.onopen = () => logger.info('WebRTC DataChannel opened (offerer)', { peerId: localPeerId })
  dc.onclose = () => logger.info('WebRTC DataChannel closed (offerer)', { peerId: localPeerId })

  logger.info('WebRTC offer created', { peerId: localPeerId, roomId })
  return encoded
}

/**
 * Accept a remote offer as the answering peer.
 * Returns a base64-encoded answer string for manual copy/paste back to the offerer.
 */
export async function addRemoteOffer(
  encodedOffer: string,
  localPeerId: string,
  localDisplayName: string
): Promise<string> {
  const payload = decodePairingPayload(encodedOffer)
  if (!payload || payload.type !== 'offer') {
    throw new Error('Invalid or malformed pairing offer.')
  }
  const valid = await verifyPairingChecksum(payload)
  if (!valid) {
    throw new Error('Pairing offer checksum mismatch — payload may have been tampered with.')
  }

  const pc = makePeerConnection()

  pc.ondatachannel = (event) => {
    const dc = event.channel
    dc.onmessage = (msgEvent) => handleInboundMessage(payload.peerId, msgEvent)
    dc.onopen = () => logger.info('WebRTC DataChannel opened (answerer)', { peerId: payload.peerId })
    dc.onclose = () => logger.info('WebRTC DataChannel closed (answerer)', { peerId: payload.peerId })

    const entry = peers.get(payload.peerId)
    if (entry) entry.dataChannel = dc
  }

  await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)

  await waitForIceGathering(pc)

  const sdp = pc.localDescription?.sdp ?? answer.sdp ?? ''

  const encoded = await encodePairingPayload({
    version: 1,
    type: 'answer',
    roomId: payload.roomId,
    peerId: localPeerId,
    displayName: localDisplayName,
    timestamp: nowISO(),
    verificationCode: payload.verificationCode,
    sdp,
    iceCandidates: [],
  })

  const entry: PeerEntry = {
    peerId: payload.peerId,
    connection: pc,
    dataChannel: null,
    descriptor: {
      peerId: payload.peerId,
      displayName: payload.displayName,
      roomId: payload.roomId,
      connectionState: pc.connectionState,
      dataChannelState: 'connecting',
      connectedAt: nowISO(),
      lastMessageAt: null,
    },
  }
  peers.set(payload.peerId, entry)

  logger.info('WebRTC answer created', { remotePeerId: payload.peerId })
  return encoded
}

/**
 * Apply a remote answer to the initiating peer's connection.
 * Call this on the offerer side after receiving the answerer's encoded answer.
 */
export async function acceptAnswer(
  localPeerId: string,
  encodedAnswer: string
): Promise<void> {
  const payload = decodePairingPayload(encodedAnswer)
  if (!payload || payload.type !== 'answer') {
    throw new Error('Invalid or malformed pairing answer.')
  }
  const valid = await verifyPairingChecksum(payload)
  if (!valid) {
    throw new Error('Pairing answer checksum mismatch — payload may have been tampered with.')
  }

  const entry = peers.get(localPeerId)
  if (!entry) throw new Error(`No pending connection found for peerId: ${localPeerId}`)

  await entry.connection.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
  logger.info('WebRTC remote answer applied', { localPeerId, remotePeerId: payload.peerId })
}

/** Send a collaboration message to a specific peer via their DataChannel. */
export function sendCollabMessage(peerId: string, msg: CollabMessage): void {
  const entry = peers.get(peerId)
  if (!entry?.dataChannel || entry.dataChannel.readyState !== 'open') {
    logger.warn('sendCollabMessage: DataChannel not open', { peerId })
    return
  }
  entry.dataChannel.send(JSON.stringify(msg))
  if (entry.descriptor) {
    entry.descriptor.lastMessageAt = nowISO()
  }
}

/** Broadcast a collaboration message to all connected peers. */
export function broadcastCollabMessage(msg: CollabMessage): void {
  for (const [peerId] of peers) {
    sendCollabMessage(peerId, msg)
  }
}

/** Subscribe to inbound collaboration messages from any peer. */
export function onCollabMessage(handler: CollabMessageHandler): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

/** Close a specific peer connection and remove it. */
export function closePeer(peerId: string): void {
  const entry = peers.get(peerId)
  if (!entry) return
  entry.dataChannel?.close()
  entry.connection.close()
  peers.delete(peerId)
  logger.info('WebRTC peer closed', { peerId })
}

/** Close all peer connections. */
export function closeAll(): void {
  for (const [peerId] of peers) {
    closePeer(peerId)
  }
}

/** Get a snapshot of all current peer descriptors. */
export function listPeers(): PeerDescriptor[] {
  return Array.from(peers.values()).map((e) => ({ ...e.descriptor }))
}

/** Get a specific peer descriptor by ID. */
export function getPeer(peerId: string): PeerDescriptor | undefined {
  const entry = peers.get(peerId)
  return entry ? { ...entry.descriptor } : undefined
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function handleInboundMessage(peerId: string, event: MessageEvent): void {
  try {
    const msg = JSON.parse(event.data as string) as CollabMessage
    const entry = peers.get(peerId)
    if (entry) entry.descriptor.lastMessageAt = nowISO()
    for (const handler of messageHandlers) {
      handler(peerId, msg)
    }
  } catch (err) {
    logger.error('WebRTC: failed to parse inbound message', { peerId, err })
  }
}

/**
 * Wait for ICE gathering to complete or timeout after 2 s.
 * In a LAN-only app with no STUN/TURN, gathering completes quickly.
 */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      resolve()
    }, 2000)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout)
        resolve()
      }
    }
  })
}

/** Generate a new peer ID for use in pairing flows. */
export function generatePeerId(): string {
  return generateId()
}
