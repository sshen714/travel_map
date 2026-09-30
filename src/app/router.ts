import { createRouter, createWebHashHistory } from 'vue-router'
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('../views/OverviewView.vue') },
    { path: '/day/:dayId(\\d+)', component: () => import('../views/DayView.vue') },
    { path: '/map', component: () => import('../views/MapView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
