# 部署指南

## COOP/COEP 配置

3DGS 渲染依赖 `SharedArrayBuffer`，需要在服务器配置跨域隔离头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 各平台配置

### Vite (开发环境)

```javascript
// vite.config.js
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
};
```

### Nginx

```nginx
server {
    location / {
        add_header Cross-Origin-Opener-Policy "same-origin";
        add_header Cross-Origin-Embedder-Policy "require-corp";
    }
}
```

### Apache

```apache
<IfModule mod_headers.c>
    Header set Cross-Origin-Opener-Policy "same-origin"
    Header set Cross-Origin-Embedder-Policy "require-corp"
</IfModule>
```

### Vercel

```json
// vercel.json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

### Cloudflare Pages

```toml
# _headers
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### GitHub Pages

GitHub Pages 不支持自定义 HTTP 头。使用 Service Worker 代理方案：

```javascript
// sw.js
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      return new Response(response.body, { headers });
    })
  );
});
```

## 静态资源部署

3DGS 场景文件 (`.splat`, `.spz`, `.sog`) 需要正确配置 MIME 类型和 CORS：

```nginx
# .splat 文件
location ~ \.splat$ {
    add_header Access-Control-Allow-Origin *;
    add_header Content-Type application/octet-stream;
}

# SOG 流式加载需要 Range 请求支持
location ~ \.sog$ {
    add_header Accept-Ranges bytes;
    add_header Access-Control-Allow-Origin *;
}
```
