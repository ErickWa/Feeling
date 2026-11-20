// Every /api route: closed until go-live, and no error ever echoes a body.
import { gate } from "../../lib/api.js";
export const onRequest = ({ request, env, next }) => gate(request, env, next);
