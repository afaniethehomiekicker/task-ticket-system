// There is no separate Super Admin portal any more: every role signs in on
// the same page. /admin-login is kept only so old bookmarks still work — it
// shows the normal login, and App.jsx sends the user to "/" once signed in.
export { Login as AdminLogin } from './login';
