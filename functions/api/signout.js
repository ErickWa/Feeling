import { signout } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => signout(request, env);
