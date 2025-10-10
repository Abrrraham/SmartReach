import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../pages/Home.vue')
    },
    {
      path: '/workbench',
      name: 'workbench',
      component: () => import('../pages/Workbench.vue')
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../pages/About.vue')
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
});

export default router;
