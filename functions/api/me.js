import { me } from "../../lib/api.js";
export const onRequestGet = ({ request, env }) => me(request, env);
