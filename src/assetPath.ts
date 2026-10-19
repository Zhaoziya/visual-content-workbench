export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;

export const resolveAssetUrl = (url: string) => url.startsWith('/assets/') ? assetUrl(url) : url;
