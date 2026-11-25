import { digest } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => digest(request, env);
