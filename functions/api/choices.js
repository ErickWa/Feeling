import { choices } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => choices(request, env);
