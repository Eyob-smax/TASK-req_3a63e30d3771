// REQ: R11 / R15 — App bootstrap smoke test: Vue 3 + Pinia + Router wiring + session lifecycle
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import { routes } from '@/router'
import { useSessionStore } from '@/stores/session-store'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes,
  })
}

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts successfully with router and pinia', async () => {
    const router = createTestRouter()
    const pinia = createPinia()

    router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [router, pinia],
      },
    })

    expect(wrapper.exists()).toBe(true)
  })

  it('renders a router-view element', async () => {
    const router = createTestRouter()
    const pinia = createPinia()

    router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [router, pinia],
      },
    })

    // The router-view renders the HomePage component for '/'
    expect(wrapper.html()).toContain('ForgeRoom')
  })

  it('installs Pinia without errors', () => {
    const pinia = createPinia()
    expect(pinia).toBeDefined()
    expect(pinia.install).toBeInstanceOf(Function)
  })

  it('debounces user activity and records it once per window', async () => {
    vi.useFakeTimers()
    const router = createTestRouter()
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useSessionStore()
    const initializeSpy = vi.spyOn(session, 'initialize').mockResolvedValue(undefined)
    const recordActivitySpy = vi.spyOn(session, 'recordActivity').mockImplementation(() => {})

    router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [router, pinia],
      },
    })

    await flushPromises()

    window.dispatchEvent(new MouseEvent('mousemove'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }))
    window.dispatchEvent(new MouseEvent('click'))

    expect(recordActivitySpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(recordActivitySpy).toHaveBeenCalledTimes(1)
    expect(initializeSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('registers and removes app-level activity listeners on mount lifecycle', async () => {
    const router = createTestRouter()
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useSessionStore()
    vi.spyOn(session, 'initialize').mockResolvedValue(undefined)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    router.push('/')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [router, pinia],
      },
    })

    await flushPromises()

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), { passive: true })
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { passive: true })
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), { passive: true })
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true, capture: true })

    wrapper.unmount()

    await flushPromises()

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
