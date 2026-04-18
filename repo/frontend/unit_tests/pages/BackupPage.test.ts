// REQ: R20 — BackupPage: export trigger, import file selection, validation results, row errors, truncation notice

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { BACKUP_FORMAT, MAX_BULK_IMPORT_ITEMS } from '@/models/constants'

const mockExportRoom = vi.fn(async () => {})
const mockValidateImport = vi.fn(async () => null)
const mockPersistImport = vi.fn(async () => {})
const mockParseManifest = vi.fn(async () => null)
const mockClearError = vi.fn()
const mockConfirm = vi.fn(async () => false)
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/layouts/AppLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

vi.mock('@/components/LimitIndicator.vue', () => ({
  default: { template: '<div />', props: ['current', 'max', 'label'] },
}))

vi.mock('@/stores/import-export-store', () => ({
  useImportExportStore: vi.fn(() => ({
    isExporting: false,
    isImporting: false,
    lastError: null,
    lastImportResult: null,
    exportProgress: 0,
    importProgress: 0,
    exportRoom: mockExportRoom,
    validateImport: mockValidateImport,
    persistImport: mockPersistImport,
    parseManifest: mockParseManifest,
    clearError: mockClearError,
  })),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({
    activeProfile: { displayName: 'Alice' },
  }),
}))

vi.mock('@/stores/room-store', () => ({
  useRoomStore: () => ({ activeRoom: { roomId: 'room-1', name: 'Test Room' } }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUiStore: () => ({
    confirm: mockConfirm,
    toast: { success: mockToastSuccess, error: mockToastError },
  }),
}))

async function mountPage(storeOverrides = {}) {
  const { useImportExportStore } = await import('@/stores/import-export-store')
  vi.mocked(useImportExportStore).mockReturnValue({
    isExporting: false,
    isImporting: false,
    lastError: null,
    lastImportResult: null,
    exportProgress: 0,
    importProgress: 0,
    exportRoom: mockExportRoom,
    validateImport: mockValidateImport,
    persistImport: mockPersistImport,
    parseManifest: mockParseManifest,
    clearError: mockClearError,
    ...storeOverrides,
  } as any)

  const { default: BackupPage } = await import('@/pages/BackupPage.vue')
  return mount(BackupPage, {
    props: { roomId: 'room-1' },
    attachTo: document.body,
  })
}

describe('BackupPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders export and import sections', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="export-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pick-file-btn"]').exists()).toBe(true)
  })

  it('calls exportRoom with roomId and displayName when export button clicked', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-testid="export-btn"]').trigger('click')
    await flushPromises()
    expect(mockExportRoom).toHaveBeenCalledWith('room-1', 'Alice')
  })

  it('disables export button when isExporting=true', async () => {
    const wrapper = await mountPage({ isExporting: true })
    const btn = wrapper.find('[data-testid="export-btn"]').element as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('shows export error when lastError is set and not importing', async () => {
    const wrapper = await mountPage({ lastError: 'Export failed.' })
    expect(wrapper.find('[data-testid="export-error"]').text()).toBe('Export failed.')
  })

  it('shows validation result after file selection — success', async () => {
    const successResult = {
      success: true,
      totalRows: 5,
      validRows: 5,
      errorRows: [],
      warnings: [],
      truncated: false,
    }
    mockValidateImport.mockResolvedValueOnce(successResult)
    mockParseManifest.mockResolvedValueOnce({
      roomId: 'room-1',
      roomName: 'Test Room',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'Alice',
      stats: { totalElements: 3, totalImages: 0, totalComments: 1, totalChatMessages: 1, totalSnapshots: 0 },
      data: {},
    })

    const wrapper = await mountPage({ lastImportResult: successResult })
    // Directly trigger file selection by calling the onFileSelected handler
    const fileInput = wrapper.find('[data-testid="file-input"]')
    const fakeFile = new File(['{}'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(fileInput.element, 'files', { value: [fakeFile], configurable: true })
    await fileInput.trigger('change')
    await flushPromises()

    expect(mockValidateImport).toHaveBeenCalledWith(fakeFile)
  })

  it('shows row errors when validation has errorRows', async () => {
    const errorResult = {
      success: false,
      totalRows: 2,
      validRows: 1,
      errorRows: [{ rowIndex: 0, rowType: 'element', error: 'Missing elementId.' }],
      warnings: [],
      truncated: false,
    }
    const wrapper = await mountPage({ lastImportResult: errorResult })
    expect(wrapper.find('[data-testid="row-errors"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="row-errors"]').text()).toContain('Missing elementId.')
  })

  it('shows truncation notice when result.truncated=true', async () => {
    const truncatedResult = {
      success: false,
      totalRows: MAX_BULK_IMPORT_ITEMS + 100,
      validRows: MAX_BULK_IMPORT_ITEMS,
      errorRows: [
        {
          rowIndex: 0,
          rowType: 'element',
          field: 'bulkImportCount',
          error: 'Batch exceeds cap.',
        },
      ],
      warnings: [`Batch contains ${MAX_BULK_IMPORT_ITEMS + 100} sticky notes + comments.`],
      truncated: true,
    }
    const wrapper = await mountPage({ lastImportResult: truncatedResult })
    expect(wrapper.find('[data-testid="truncation-notice"]').exists()).toBe(true)
  })

  it('shows warnings list when warnings are present', async () => {
    const warnResult = {
      success: true,
      totalRows: 1,
      validRows: 1,
      errorRows: [],
      warnings: ['Some batch warning.'],
      truncated: false,
    }
    const wrapper = await mountPage({ lastImportResult: warnResult })
    expect(wrapper.find('[data-testid="import-warnings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="import-warnings"]').text()).toContain('Some batch warning.')
  })

  it('shows confirm-import button only when validation succeeds and manifest is parsed', async () => {
    const successResult = {
      success: true,
      totalRows: 1,
      validRows: 1,
      errorRows: [],
      warnings: [],
      truncated: false,
    }
    // Simulate state where validation passed and manifest parsed
    mockValidateImport.mockResolvedValueOnce(successResult)
    mockParseManifest.mockResolvedValueOnce({
      roomId: 'room-1',
      roomName: 'Test Room',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'Alice',
      stats: { totalElements: 0, totalImages: 0, totalComments: 0, totalChatMessages: 0, totalSnapshots: 0 },
      data: {},
    })

    const wrapper = await mountPage({ lastImportResult: successResult })
    // No manifest parsed yet in this mount — button should not appear
    expect(wrapper.find('[data-testid="confirm-import-btn"]').exists()).toBe(false)
  })

  it('triggerFilePicker clears stale import state and clicks hidden file input', async () => {
    const wrapper = await mountPage({
      lastImportResult: {
        success: true,
        totalRows: 1,
        validRows: 1,
        errorRows: [],
        warnings: [],
        truncated: false,
      },
      lastError: 'stale error',
    })
    const fileInput = wrapper.find('[data-testid="file-input"]').element as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')

    await wrapper.find('[data-testid="pick-file-btn"]').trigger('click')

    expect(mockClearError).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('confirmImport persists validated manifest and navigates to workspace when confirmed', async () => {
    const successResult = {
      success: true,
      totalRows: 5,
      validRows: 5,
      errorRows: [],
      warnings: [],
      truncated: false,
    }
    mockConfirm.mockResolvedValueOnce(true)
    mockValidateImport.mockResolvedValueOnce(successResult)
    mockParseManifest.mockResolvedValueOnce({
      format: BACKUP_FORMAT,
      version: 1,
      roomId: 'room-1',
      roomName: 'Test Room',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'Alice',
      stats: { totalElements: 3, totalImages: 0, totalComments: 1, totalChatMessages: 1, totalSnapshots: 0 },
      data: {},
    })

    const wrapper = await mountPage({ lastImportResult: successResult })
    const fileInput = wrapper.find('[data-testid="file-input"]')
    const fakeFile = new File(['{}'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(fileInput.element, 'files', { value: [fakeFile], configurable: true })
    await fileInput.trigger('change')
    await flushPromises()

    const confirmBtn = wrapper.find('[data-testid="confirm-import-btn"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockPersistImport).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith({ name: 'workspace', params: { roomId: 'room-1' } })
    expect(mockToastSuccess).toHaveBeenCalledWith('Backup imported successfully.')
  })

  it('confirmImport shows persist error when import persistence fails', async () => {
    const successResult = {
      success: true,
      totalRows: 3,
      validRows: 3,
      errorRows: [],
      warnings: [],
      truncated: false,
    }
    mockConfirm.mockResolvedValueOnce(true)
    mockPersistImport.mockRejectedValueOnce(new Error('DB write failed'))
    mockValidateImport.mockResolvedValueOnce(successResult)
    mockParseManifest.mockResolvedValueOnce({
      format: BACKUP_FORMAT,
      version: 1,
      roomId: 'room-1',
      roomName: 'Test Room',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'Alice',
      stats: { totalElements: 1, totalImages: 0, totalComments: 1, totalChatMessages: 1, totalSnapshots: 0 },
      data: {},
    })

    const wrapper = await mountPage({
      lastImportResult: successResult,
      lastError: 'Persist failed from store',
    })
    const fileInput = wrapper.find('[data-testid="file-input"]')
    const fakeFile = new File(['{}'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(fileInput.element, 'files', { value: [fakeFile], configurable: true })
    await fileInput.trigger('change')
    await flushPromises()

    await wrapper.find('[data-testid="confirm-import-btn"]').trigger('click')
    await flushPromises()

    expect(mockPersistImport).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="persist-error"]').exists()).toBe(true)
    expect(mockToastError).toHaveBeenCalledWith('Persist failed from store')
  })

  it('cancelImport clears parsed manifest and resets import actions', async () => {
    const successResult = {
      success: true,
      totalRows: 2,
      validRows: 2,
      errorRows: [],
      warnings: [],
      truncated: false,
    }
    mockValidateImport.mockResolvedValueOnce(successResult)
    mockParseManifest.mockResolvedValueOnce({
      format: BACKUP_FORMAT,
      version: 1,
      roomId: 'room-1',
      roomName: 'Test Room',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'Alice',
      stats: { totalElements: 1, totalImages: 0, totalComments: 1, totalChatMessages: 0, totalSnapshots: 0 },
      data: {},
    })

    const wrapper = await mountPage({ lastImportResult: successResult })
    const fileInput = wrapper.find('[data-testid="file-input"]')
    const fakeFile = new File(['{}'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(fileInput.element, 'files', { value: [fakeFile], configurable: true })
    await fileInput.trigger('change')
    await flushPromises()

    expect(wrapper.find('[data-testid="confirm-import-btn"]').exists()).toBe(true)

    const cancelBtn = wrapper.find('.backup-page__import-actions .backup-page__btn')
    await cancelBtn.trigger('click')
    await flushPromises()

    expect(mockClearError).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="confirm-import-btn"]').exists()).toBe(false)
  })
})
