import { signin } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => signin(request, env);
