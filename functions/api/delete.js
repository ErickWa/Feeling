import { remove } from "../../lib/api.js";
export const onRequestPost = ({ request, env }) => remove(request, env);
