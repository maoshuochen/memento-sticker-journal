const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/cutout') {
      return Response.json(
        { error: 'Cloud cutout is not configured yet.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return env.ASSETS.fetch(request);
  }
};

export default worker;
