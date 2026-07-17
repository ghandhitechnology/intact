import { isIP } from 'node:net';

const TRUSTED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

const TRUSTED_PUSH_SUFFIXES = [
  'push.apple.com',
  'notify.windows.com',
];

function configuredHosts() {
  return new Set(
    (process.env.PUSH_ENDPOINT_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
      .filter((host) => Boolean(host) && !isIP(host) && /^[a-z0-9.-]+$/.test(host)),
  );
}

export function isTrustedPushEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || (url.port && url.port !== '443')
    || isIP(host)
    || !host
  ) return false;

  if (TRUSTED_PUSH_HOSTS.has(host) || configuredHosts().has(host)) return true;
  return TRUSTED_PUSH_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
