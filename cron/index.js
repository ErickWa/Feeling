// The daily trigger for the summary mail. Pages Functions cannot run on a
// schedule, so this Worker's only job is to call POST /api/digest once a day;
// every rule about what is counted and sent lives in lib/api.js, where the
// tests and the gate can see it. It holds no secret and no binding.
export default {
  scheduled: (_controller, _env, ctx) => ctx.waitUntil(fetch("https://feelingthemachine.com/api/digest", { method: "POST" })),
};
