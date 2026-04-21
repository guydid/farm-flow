/**
 * Creates a page URL from a page name with optional query string.
 * e.g. createPageUrl("Dashboard") => "/Dashboard"
 * e.g. createPageUrl("EmployeeDetail?id=123") => "/EmployeeDetail?id=123"
 */
export function createPageUrl(pageNameWithParams) {
  if (!pageNameWithParams) return '/';
  const [pageName, params] = pageNameWithParams.split('?');
  return params ? `/${pageName}?${params}` : `/${pageName}`;
}
