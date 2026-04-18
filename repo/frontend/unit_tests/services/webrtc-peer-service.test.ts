// REQ: R19 — WebRTC peer service: createOffer, addRemoteOffer, closePeer, message routing

import { describe, it, expect, vi, beforeEach } from 'vitest'

// RTCPeerConnection is not available in jsdom — stub globally
class MockDataChannel {
  readyState = 'open'
  onmessage: ((e: MessageEvent) => void) | null = null
  send = vi.fn()
  close = vi.fn()
}

class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = []

  connectionState = 'new'
  signalingState = 'stable'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  iceGatheringState = 'complete'
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null

  constructor() {
    MockRTCPeerConnection.instances.push(this)
  }

  _dc: MockDataChannel = new MockDataChannel()

  createDataChannel(_label: string): MockDataChannel {
    return this._dc
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc as RTCSessionDescription
    // Simulate immediate ICE gathering complete
    this.iceGatheringState = 'complete'
    setTimeout(() => this.onicegatheringstatechange?.(), 0)
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc as RTCSessionDescription
  }

  close = vi.fn()
}

vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)

vi.mock('@/models/constants', () => ({
  DATA_CHANNEL_LABEL: 'collab',
  PAIRING_PROTOCOL_VERSION: 1,
}))

vi.mock('@/utils/id-generator', () => ({
  generateId: vi.fn(() => 'gen-id'),
  generateVerificationCode: vi.fn(() => 'VER-CODE'),
}))

vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

function makeOfferPayload() {
  return {
    version: 1,
    type: 'offer' as const,
    roomId: 'room-1',
    peerId: 'remote-peer',
    displayName: 'Remote',
    timestamp: '2026-01-01T00:00:00.000Z',
    verificationCode: 'VER-CODE',
    sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n',
    iceCandidates: [],
  }
}

function makeAnswerPayload() {
  return {
    version: 1,
    type: 'answer' as const,
    roomId: 'room-1',
    peerId: 'remote-peer',
    displayName: 'Remote',
    timestamp: '2026-01-01T00:00:00.000Z',
    verificationCode: 'VER-CODE',
    sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',
    iceCandidates: [],
  }
}

async function encodePayload(payload: ReturnType<typeof makeOfferPayload> | ReturnType<typeof makeAnswerPayload>) {
  const pairingCodec = await import('@/serializers/pairing-codec')
  return pairingCodec.encodePairingPayload(payload)
}

describe('webrtc-peer-service', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    MockRTCPeerConnection.instances = []
    // Reset module state between tests
    const svc = await import('@/services/webrtc-peer-service')
    svc.closeAll()
  })

  describe('generatePeerId', () => {
    it('returns a non-empty string', async () => {
      const { generatePeerId } = await import('@/services/webrtc-peer-service')
      const id = generatePeerId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
  })

  describe('createOffer', () => {
    it('returns an encoded offer string', async () => {
      const { createOffer } = await import('@/services/webrtc-peer-service')
      const result = await createOffer('room-1', 'peer-1', 'Host')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('registers the peer entry', async () => {
      const { createOffer, listPeers } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')
      expect(listPeers()).toHaveLength(1)
      expect(listPeers()[0].peerId).toBe('peer-1')
    })
  })

  describe('addRemoteOffer', () => {
    it('returns an encoded answer string', async () => {
      const { addRemoteOffer } = await import('@/services/webrtc-peer-service')
      const fakeOffer = await encodePayload(makeOfferPayload())
      const answer = await addRemoteOffer(fakeOffer, 'local-peer', 'Local')
      expect(typeof answer).toBe('string')
      expect(answer.length).toBeGreaterThan(0)
    })

    it('throws for malformed offer payload', async () => {
      const { addRemoteOffer } = await import('@/services/webrtc-peer-service')
      await expect(addRemoteOffer('not-json', 'local-peer', 'Local')).rejects.toThrow(
        /Invalid|malformed/i
      )
    })

    it('throws for malformed offer payload encoded as invalid base64', async () => {
      const { addRemoteOffer } = await import('@/services/webrtc-peer-service')
      await expect(addRemoteOffer('%%%not-base64%%%', 'local-peer', 'Local')).rejects.toThrow(
        /Invalid|malformed/i
      )
    })

    it('throws for malformed offer payload encoded as base64 non-JSON', async () => {
      const { addRemoteOffer } = await import('@/services/webrtc-peer-service')
      const badEncoded = btoa('not-json')
      await expect(addRemoteOffer(badEncoded, 'local-peer', 'Local')).rejects.toThrow(
        /Invalid|malformed/i
      )
    })

    it('throws when offer checksum fails', async () => {
      const pairingCodec = await import('@/serializers/pairing-codec')
      vi.spyOn(pairingCodec, 'verifyPairingChecksum').mockResolvedValueOnce(false)

      const { addRemoteOffer } = await import('@/services/webrtc-peer-service')
      const fakeOffer = await encodePayload(makeOfferPayload())
      await expect(addRemoteOffer(fakeOffer, 'local-peer', 'Local')).rejects.toThrow(/checksum/i)
    })
  })

  describe('acceptAnswer', () => {
    it('applies a valid remote answer to existing peer connection', async () => {
      const { createOffer, acceptAnswer } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')

      const encodedAnswer = await encodePayload(makeAnswerPayload())

      await expect(acceptAnswer('peer-1', encodedAnswer)).resolves.toBeUndefined()
      expect(MockRTCPeerConnection.instances[0]?.remoteDescription?.type).toBe('answer')
    })

    it('throws for malformed answer payload', async () => {
      const { acceptAnswer } = await import('@/services/webrtc-peer-service')
      await expect(acceptAnswer('peer-1', 'not-json')).rejects.toThrow(/Invalid|malformed/i)
    })

    it('throws for malformed answer payload encoded as invalid base64', async () => {
      const { acceptAnswer } = await import('@/services/webrtc-peer-service')
      await expect(acceptAnswer('peer-1', '%%%not-base64%%%')).rejects.toThrow(/Invalid|malformed/i)
    })

    it('throws for malformed answer payload encoded as base64 non-JSON', async () => {
      const { acceptAnswer } = await import('@/services/webrtc-peer-service')
      const badEncoded = btoa('not-json')
      await expect(acceptAnswer('peer-1', badEncoded)).rejects.toThrow(/Invalid|malformed/i)
    })

    it('throws when answer checksum fails', async () => {
      const pairingCodec = await import('@/serializers/pairing-codec')
      vi.spyOn(pairingCodec, 'verifyPairingChecksum').mockResolvedValueOnce(false)

      const { createOffer, acceptAnswer } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')

      const encodedAnswer = await encodePayload(makeAnswerPayload())

      await expect(acceptAnswer('peer-1', encodedAnswer)).rejects.toThrow(/checksum/i)
    })

    it('throws when no pending connection exists for local peer', async () => {
      const { acceptAnswer } = await import('@/services/webrtc-peer-service')
      const encodedAnswer = await encodePayload(makeAnswerPayload())
      await expect(acceptAnswer('unknown-peer', encodedAnswer)).rejects.toThrow(/No pending connection/i)
    })
  })

  describe('closePeer', () => {
    it('removes peer from registry', async () => {
      const { createOffer, closePeer, listPeers } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')
      expect(listPeers()).toHaveLength(1)
      closePeer('peer-1')
      expect(listPeers()).toHaveLength(0)
    })

    it('is a no-op for unknown peer', async () => {
      const { closePeer, listPeers } = await import('@/services/webrtc-peer-service')
      expect(() => closePeer('unknown')).not.toThrow()
      expect(listPeers()).toHaveLength(0)
    })
  })

  describe('closeAll', () => {
    it('removes all peers', async () => {
      const { createOffer, closeAll, listPeers } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')
      await createOffer('room-1', 'peer-2', 'Host2')
      closeAll()
      expect(listPeers()).toHaveLength(0)
    })
  })

  describe('onCollabMessage / sendCollabMessage', () => {
    it('onCollabMessage returns an unsubscribe function', async () => {
      const { onCollabMessage } = await import('@/services/webrtc-peer-service')
      const handler = vi.fn()
      const unsub = onCollabMessage(handler)
      expect(typeof unsub).toBe('function')
      unsub()
    })

    it('routes inbound JSON payloads to subscribed handlers', async () => {
      const { createOffer, onCollabMessage } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')

      const handler = vi.fn()
      const unsub = onCollabMessage(handler)

      const dc = MockRTCPeerConnection.instances[0]?._dc
      dc?.onmessage?.({ data: JSON.stringify({ type: 'cursor:update', payload: { x: 1, y: 2 } }) } as MessageEvent)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('peer-1', {
        type: 'cursor:update',
        payload: { x: 1, y: 2 },
      })
      unsub()
    })

    it('unsubscribed handlers no longer receive inbound messages', async () => {
      const { createOffer, onCollabMessage } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')

      const handler = vi.fn()
      const unsub = onCollabMessage(handler)
      unsub()

      const dc = MockRTCPeerConnection.instances[0]?._dc
      dc?.onmessage?.({ data: JSON.stringify({ type: 'noop' }) } as MessageEvent)

      expect(handler).not.toHaveBeenCalled()
    })

    it('logs parse errors for malformed inbound messages', async () => {
      const { createOffer } = await import('@/services/webrtc-peer-service')
      const { logger } = await import('@/utils/logger')
      await createOffer('room-1', 'peer-1', 'Host')

      const dc = MockRTCPeerConnection.instances[0]?._dc
      dc?.onmessage?.({ data: '{bad json' } as MessageEvent)

      expect(logger.error).toHaveBeenCalled()
    })

    it('sendCollabMessage is a no-op when peer/channel is unavailable', async () => {
      const { sendCollabMessage } = await import('@/services/webrtc-peer-service')
      const { logger } = await import('@/utils/logger')
      sendCollabMessage('missing-peer', { type: 'chat:new' } as any)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('sendCollabMessage sends serialized payload when channel is open', async () => {
      const { createOffer, sendCollabMessage } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')

      sendCollabMessage('peer-1', { type: 'chat:new', body: { text: 'hello' } } as any)

      const dc = MockRTCPeerConnection.instances[0]?._dc
      expect(dc?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'chat:new', body: { text: 'hello' } }))
    })

    it('broadcastCollabMessage sends to all registered peers', async () => {
      const { createOffer, broadcastCollabMessage } = await import('@/services/webrtc-peer-service')
      await createOffer('room-1', 'peer-1', 'Host')
      await createOffer('room-1', 'peer-2', 'Host2')

      broadcastCollabMessage({ type: 'presence:update', payload: { active: true } } as any)

      const firstDc = MockRTCPeerConnection.instances[0]?._dc
      const secondDc = MockRTCPeerConnection.instances[1]?._dc
      expect(firstDc?.send).toHaveBeenCalledTimes(1)
      expect(secondDc?.send).toHaveBeenCalledTimes(1)
    })

    it('returns undefined for missing peer and descriptor snapshot for existing peer', async () => {
      const { createOffer, getPeer } = await import('@/services/webrtc-peer-service')
      expect(getPeer('missing')).toBeUndefined()

      await createOffer('room-1', 'peer-1', 'Host')
      const peer = getPeer('peer-1')
      expect(peer).toBeTruthy()
      expect(peer?.peerId).toBe('peer-1')
    })

    it('wires answerer datachannel via ondatachannel event and can send to that peer', async () => {
      const { addRemoteOffer, sendCollabMessage } = await import('@/services/webrtc-peer-service')
      const fakeOffer = await encodePayload(makeOfferPayload())
      await addRemoteOffer(fakeOffer, 'local-peer', 'Local')

      const answerPc = MockRTCPeerConnection.instances[0]
      const inboundDc = new MockDataChannel()
      answerPc?.ondatachannel?.({ channel: inboundDc } as RTCDataChannelEvent)

      sendCollabMessage('remote-peer', { type: 'chat:new', body: { text: 'from-answerer' } } as any)
      expect(inboundDc.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'chat:new', body: { text: 'from-answerer' } })
      )
    })
  })
})
