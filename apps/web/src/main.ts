import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'mdui/mdui.css';
import 'material-icons/iconfont/filled.css';
import 'material-icons/iconfont/outlined.css';
import 'material-icons/iconfont/round.css';
import 'mdui';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

const app = createApp(App);
// pinia 必须先于 router 安装：路由守卫里要用 auth store
app.use(createPinia());
app.use(router);
app.mount('#app');

// 让自定义元素与 Vue 共存：mdui 使用 Shadow DOM，不需要额外处理
