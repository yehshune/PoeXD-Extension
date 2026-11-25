import { extensionMessaging, type ExtensionProtocolMap } from './extension-protocol';

export type ExtensionMessenger = typeof extensionMessaging;

type ProtocolData<K extends keyof ExtensionProtocolMap> =
  ExtensionProtocolMap[K] extends (data: infer D) => any ? D : never;

type ProtocolReturn<K extends keyof ExtensionProtocolMap> =
  ExtensionProtocolMap[K] extends (...args: any[]) => infer R ? R : never;

export type BroadcastChannel = {
  [K in keyof ExtensionProtocolMap]: ProtocolReturn<K> extends void ? K : never;
}[keyof ExtensionProtocolMap];

export type ChangeListener<T> = (change: T) => void;

export interface RefCountedChangeHub<T> {
  subscribe(listener: ChangeListener<T>): () => void;
  readonly subscriberCount: number;
}

export function createRefCountedChangeHub<K extends BroadcastChannel>(
  channel: K,
  messenger: ExtensionMessenger = extensionMessaging,
): RefCountedChangeHub<ProtocolData<K>> {
  const subscribers = new Set<ChangeListener<ProtocolData<K>>>();
  let unhookMessenger: (() => void) | undefined;

  return {
    subscribe(listener: ChangeListener<ProtocolData<K>>): () => void {
      subscribers.add(listener);
      if (!unhookMessenger) {
        unhookMessenger = messenger.onMessage(channel, (message) => {
          for (const subscriber of subscribers) {
            try {
              subscriber(message.data as ProtocolData<K>);
            } catch {
              // Individual subscriber failure does not abort other subscribers or transport
            }
          }
        });
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0 && unhookMessenger) {
          unhookMessenger();
          unhookMessenger = undefined;
        }
      };
    },
    get subscriberCount() {
      return subscribers.size;
    },
  };
}

export interface TradeTabBroadcastTransport<T> {
  listTradeTabIds(): Promise<number[]>;
  sendChangeToTab(tabId: number, payload: T): Promise<void>;
}

export async function broadcastToTradeTabs<T>(
  payload: T,
  transport: TradeTabBroadcastTransport<T>,
): Promise<void> {
  const tabIds = await transport.listTradeTabIds();
  await Promise.allSettled(tabIds.map((tabId) => transport.sendChangeToTab(tabId, payload)));
}

export function createTradeTabBroadcastTransport<K extends BroadcastChannel>(
  channel: K,
  listTradeTabIds: () => Promise<number[]>,
  messenger: ExtensionMessenger = extensionMessaging,
): TradeTabBroadcastTransport<ProtocolData<K>> {
  return {
    listTradeTabIds,
    sendChangeToTab: (tabId, payload) => messenger.sendMessage(channel, payload as any, tabId),
  };
}

export type UnavailableCapableChannel = {
  [K in keyof ExtensionProtocolMap]: UnavailableOutcome extends ProtocolReturn<K> ? K : never;
}[keyof ExtensionProtocolMap];

export interface ReadyGatedHandlerOptions<K extends UnavailableCapableChannel> {
  getReady: () => Promise<{ ok: true } | Extract<ProtocolReturn<K>, { ok: false }>>;
  handle: (data: ProtocolData<K>) => Promise<ProtocolReturn<K>> | ProtocolReturn<K>;
  messenger?: ExtensionMessenger;
}

export function registerReadyGatedHandler<K extends UnavailableCapableChannel>(
  channel: K,
  options: ReadyGatedHandlerOptions<K>,
): () => void {
  const messenger = options.messenger ?? extensionMessaging;
  return messenger.onMessage(channel, (async (message: { data: ProtocolData<K> }) => {
    try {
      const outcome = await options.getReady();
      if (!outcome.ok) return outcome;
      return await options.handle(message.data);
    } catch (error) {
      return unavailableOutcome(error instanceof Error ? error.message : String(error));
    }
  }) as any);
}

export interface UnavailableOutcome {
  ok: false;
  error: {
    code: 'unavailable';
    message: string;
  };
}

export function unavailableOutcome(message: string): UnavailableOutcome {
  return {
    ok: false,
    error: { code: 'unavailable', message },
  };
}

export async function callBackgroundWithUnavailable<T>(
  call: () => Promise<T | undefined>,
  noResponseMessage: string,
): Promise<T | UnavailableOutcome> {
  try {
    const response = await call();
    return response ?? unavailableOutcome(noResponseMessage);
  } catch (error) {
    return unavailableOutcome(error instanceof Error ? error.message : String(error));
  }
}
