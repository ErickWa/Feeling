import { join } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => join(request, env);
