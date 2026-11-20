import { start } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => start(request, env);
