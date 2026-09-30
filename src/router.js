// 极简路由：支持 /api/threads/:id/replies 形式与末尾通配 *
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const segments = pattern.split('/').filter(Boolean);
    this.routes.push({ method, segments, handler, pattern });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchSegments(route.segments, parts);
      if (params) return { handler: route.handler, params };
    }
    return null;
  }
}

function matchSegments(patternSegments, pathSegments) {
  const params = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const pattern = patternSegments[i];
    if (pattern === '*') {
      // 尾部通配：捕获剩余路径
      params.wildcard = pathSegments.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    const value = pathSegments[i];
    if (value === undefined) return null;
    if (pattern.startsWith(':')) {
      params[pattern.slice(1)] = decodeURIComponent(value);
    } else if (pattern !== value) {
      return null;
    }
  }
  return pathSegments.length === patternSegments.length ? params : null;
}