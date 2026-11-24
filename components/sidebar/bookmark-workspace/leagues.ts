import { ref, type ComputedRef } from 'vue';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import type { BookmarkMutationIntent } from '../bookmark-model';
import type { TradeLeague } from '@/utils/trade-leagues';
import type { PoeVersion } from '@/utils/trade-context';
import { BOOKMARK_AUTO_LEAGUE } from '@/utils/bookmark-target';
import { t } from '@/utils/i18n';
import type { BookmarkWorkspaceHost } from './host';

/** 選單中的「自動」選項：書籤改為跟隨目前頁面的聯盟。 */
export const AUTO_TRADE_LEAGUE: TradeLeague = {
  id: BOOKMARK_AUTO_LEAGUE,
  text: '自動（跟隨目前聯盟）',
};

export function formatTradeLeagueText(league: TradeLeague): string {
  if (league.id === BOOKMARK_AUTO_LEAGUE) {
    return t('bookmark.league.autoOption');
  }
  return league.text;
}

export interface BookmarkLeaguesDeps {
  version: PoeVersion;
  host: BookmarkWorkspaceHost;
  bookmarks: ComputedRef<readonly Bookmark[]>;
  execute: (intent: BookmarkMutationIntent) => Promise<boolean>;
  closeAllMenus: () => void;
}

/** Workspace 內部的聯盟替換部件（沒有獨立的公開 interface）。 */
export function createBookmarkLeagues(deps: BookmarkLeaguesDeps) {
  const { version, host, bookmarks, execute, closeAllMenus } = deps;

  const tradeLeagues = ref<TradeLeague[]>([]);
  const isLeagueLoading = ref(false);
  const leagueLoadError = ref('');

  const ensureTradeLeaguesLoaded = async (): Promise<void> => {
    if (tradeLeagues.value.length > 0 || isLeagueLoading.value) return;
    isLeagueLoading.value = true;
    leagueLoadError.value = '';
    try {
      const leagues = await host.sources.fetchLeagues(version);
      if (leagues.length === 0) leagueLoadError.value = t('bookmark.league.noAvailableLeagues');
      tradeLeagues.value = leagues.length > 0 ? [AUTO_TRADE_LEAGUE, ...leagues] : [];
    } catch (error) {
      leagueLoadError.value =
        error instanceof Error ? error.message : t('bookmark.league.loadFailed');
    } finally {
      isLeagueLoading.value = false;
    }
  };

  const confirmReplaceLeague = async (
    scope: 'collection' | 'folder',
    league: TradeLeague,
    group?: BookmarkGroup,
  ): Promise<void> => {
    closeAllMenus();
    const count = bookmarks.value.filter(
      (bookmark) => scope === 'collection' || bookmark.groupId === group?.id,
    ).length;
    if (count === 0) {
      await host.feedback.alert(t('bookmark.league.emptyScope'), t('bookmark.league.dialogTitle'));
      return;
    }
    const target =
      scope === 'collection'
        ? t('bookmark.league.allBookmarksTarget')
        : t('bookmark.league.folderTarget', { name: group?.name ?? '' });
    const isAuto = league.id === AUTO_TRADE_LEAGUE.id;
    const confirmed = await host.feedback.confirm(
      isAuto
        ? t('bookmark.league.confirmAuto', { target, count })
        : t('bookmark.league.confirmFixed', { target, count, league: league.text }),
      t('bookmark.league.dialogTitle'),
    );
    if (!confirmed) return;
    const saved = await execute({
      type: 'replace-league',
      scope,
      league: league.id,
      ...(group ? { groupId: group.id } : {}),
    });
    if (saved) {
      host.feedback.toast(
        isAuto
          ? t('bookmark.league.toastAuto', { count })
          : t('bookmark.league.toastFixed', { count, league: league.text }),
      );
    }
  };

  return {
    tradeLeagues,
    isLeagueLoading,
    leagueLoadError,
    ensureTradeLeaguesLoaded,
    confirmReplaceLeague,
    formatTradeLeagueText,
  };
}
