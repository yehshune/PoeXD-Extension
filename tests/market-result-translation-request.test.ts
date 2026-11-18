// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_TRANSLATION_REQUEST_EVENT,
  receiveResultTranslationRequests,
  requestResultTranslation,
} from '@/utils/market-result-translation-request';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('result translation requests', () => {
  it('queues roots until the translator attaches, then observes each root once', () => {
    const receiver = receiveResultTranslationRequests(document);
    const early = document.createElement('div');
    document.body.appendChild(early);
    requestResultTranslation(early);
    requestResultTranslation(early);

    const observe = vi.fn();
    receiver.attach(observe);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(early);

    const late = document.createElement('div');
    document.body.appendChild(late);
    requestResultTranslation(late);
    requestResultTranslation(early);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenLastCalledWith(late);
    receiver.dispose();
  });

  it('skips roots removed before attach and ignores non-element details', () => {
    const receiver = receiveResultTranslationRequests(document);
    const removed = document.createElement('div');
    document.body.appendChild(removed);
    requestResultTranslation(removed);
    removed.remove();
    document.dispatchEvent(
      new CustomEvent(RESULT_TRANSLATION_REQUEST_EVENT, { detail: { not: 'an element' } }),
    );

    const observe = vi.fn();
    receiver.attach(observe);
    expect(observe).not.toHaveBeenCalled();
    receiver.dispose();
  });

  it('stops listening after dispose', () => {
    const receiver = receiveResultTranslationRequests(document);
    const observe = vi.fn();
    receiver.attach(observe);
    receiver.dispose();
    const root = document.createElement('div');
    document.body.appendChild(root);
    requestResultTranslation(root);
    expect(observe).not.toHaveBeenCalled();
  });
});
