// REQ: Vue Router setup — route map for ForgeRoom SPA
// REQ: R12 — Route guard wired via installSessionGuard
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { installSessionGuard, installWorkspaceMembershipGuard } from './guards'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
  },
  {
    path: '/profile',
    name: 'profile-select',
    component: () => import('@/pages/ProfileSelectPage.vue'),
  },
  {
    path: '/rooms',
    name: 'room-list',
    component: () => import('@/pages/RoomListPage.vue'),
  },
  {
    path: '/rooms/create',
    name: 'room-create',
    component: () => import('@/pages/RoomCreatePage.vue'),
  },
  {
    path: '/rooms/join',
    name: 'room-join',
    component: () => import('@/pages/RoomJoinPage.vue'),
  },
  {
    path: '/workspace/:roomId',
    name: 'workspace',
    component: () => import('@/pages/WorkspacePage.vue'),
    props: true,
  },
  {
    path: '/workspace/:roomId/settings',
    name: 'workspace-settings',
    component: () => import('@/pages/WorkspaceSettingsPage.vue'),
    props: true,
  },
  {
    path: '/workspace/:roomId/backup',
    name: 'workspace-backup',
    component: () => import('@/pages/BackupPage.vue'),
    props: true,
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Install the session guard — Pinia must be initialized before navigation fires.
installSessionGuard(router)
// Install the workspace membership guard after the session guard so that
// unlocked-but-non-member access to /workspace/:roomId is redirected.
installWorkspaceMembershipGuard(router)

export { routes }
