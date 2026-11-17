import './styles.css';
import { App } from './ui/app';
import { menuScreen } from './ui/menu';

const root = document.getElementById('app')!;
const app: App = new App(root, () => menuScreen(app));
app.home();
