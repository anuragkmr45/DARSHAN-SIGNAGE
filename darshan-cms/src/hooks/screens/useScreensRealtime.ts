import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ScreenPreviewUpdateEvent,
  ScreenRefreshRequiredEvent,
  ScreensOverview,
  ScreensSubscribeAck,
  ScreensSyncAck,
  ScreenStateUpdateEvent,
} from "@/api/types";
import { queryKeys } from "@/api/queryKeys";
import { connectScreensSocket } from "@/lib/screensSocket";
import { useAppSelector } from "@/store/hooks";
import {
  applyScreensSyncAck,
  getScreensListRealtimeFilters,
  patchScreenInPaginatedList,
  patchScreenInOverview,
  patchScreenNowPlaying,
  patchScreenPreviewInNowPlaying,
  patchScreenPreviewInOverview,
  SCREENS_REFRESH_DEBOUNCE_MS,
  shouldInvalidateFilteredScreensList,
  shouldRefetchScreenDetail,
} from "@/hooks/screens/screensRealtimeUtils";

const EMPTY_SCREEN_IDS: string[] = [];

interface UseScreensRealtimeOptions {
  enabled?: boolean;
  activeScreenId?: string | null;
  includePreview?: boolean;
  onlineOnly?: boolean;
  syncMode?: "overview" | "invalidate";
  listQueryKey?: readonly unknown[];
  groupsQueryKey?: readonly unknown[];
  onStateUpdate?: (payload: ScreenStateUpdateEvent) => void;
  onPreviewUpdate?: (payload: ScreenPreviewUpdateEvent) => void;
  onRefreshRequired?: (payload: ScreenRefreshRequiredEvent) => void;
}

export const useScreensRealtime = ({
  enabled = true,
  activeScreenId,
  includePreview = false,
  onlineOnly = false,
  syncMode = "overview",
  listQueryKey,
  groupsQueryKey,
  onStateUpdate: handleStateUpdate,
  onPreviewUpdate: handlePreviewUpdate,
  onRefreshRequired: handleRefreshRequired,
}: UseScreensRealtimeOptions) => {
  const queryClient = useQueryClient();
  const authToken = useAppSelector((state) => state.auth.token);
  const [isConnected, setIsConnected] = useState(false);
  const [rejectedScreenIds, setRejectedScreenIds] = useState<string[]>([]);
  const [pendingEmergencyScreenIds, setPendingEmergencyScreenIds] = useState<string[]>([]);
  const refreshTimeoutRef = useRef<number | null>(null);

  const detailQueryKey = useMemo(
    () =>
      queryKeys.screenNowPlaying(activeScreenId ?? undefined, {
        includeMedia: true,
        includeUrls: false,
        includePreview,
      }),
    [activeScreenId, includePreview],
  );
  const listRealtimeFilters = useMemo(() => getScreensListRealtimeFilters(listQueryKey), [listQueryKey]);

  useEffect(() => {
    if (!enabled || !authToken) {
      setIsConnected((current) => (current ? false : current));
      setRejectedScreenIds((current) => (current.length > 0 ? EMPTY_SCREEN_IDS : current));
      setPendingEmergencyScreenIds((current) => (current.length > 0 ? EMPTY_SCREEN_IDS : current));
      return;
    }

    const socket = connectScreensSocket(authToken);
    if (!socket) return;

    const overviewQueryKey = queryKeys.screensOverview({
      includeMedia: true,
      includePreview,
      onlineOnly,
    });
    const shouldSyncOverview = syncMode === "overview";

    const syncOverviewData = (ack?: ScreensSyncAck) => {
      if (!shouldSyncOverview) return;
      if (!ack) return;

      const syncedScreens = onlineOnly
        ? ack.screens.filter((screen) => screen.health_state === "ONLINE")
        : ack.screens;

      queryClient.setQueryData(overviewQueryKey, (current: ScreensOverview | undefined) =>
        applyScreensSyncAck(current as never, { ...ack, screens: syncedScreens }),
      );
    };

    const refetchOverview = () =>
      shouldSyncOverview
        ? queryClient.invalidateQueries({ queryKey: overviewQueryKey })
        : Promise.resolve();

    const refetchList = () =>
      listQueryKey ? queryClient.invalidateQueries({ queryKey: listQueryKey }) : Promise.resolve();

    const refetchGroups = () =>
      groupsQueryKey ? queryClient.invalidateQueries({ queryKey: groupsQueryKey }) : Promise.resolve();

    const refetchDetail = () => {
      if (!activeScreenId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: detailQueryKey });
    };

    const runSync = () => {
      if (!shouldSyncOverview) {
        void Promise.allSettled([refetchList(), refetchGroups(), refetchDetail()]);
        return;
      }

      socket.emit(
        "screens:sync",
        activeScreenId ? { screenIds: [activeScreenId] } : undefined,
        (ack?: ScreensSyncAck) => {
          if (!ack) {
            void refetchOverview();
            void refetchDetail();
            return;
          }

          syncOverviewData(ack);

          if (activeScreenId) {
            const matchedScreen = ack.screens.find((screen) => screen.id === activeScreenId);
            if (matchedScreen) {
              queryClient.setQueryData(detailQueryKey, (current: ReturnType<typeof patchScreenNowPlaying>) =>
                patchScreenNowPlaying(current as never, matchedScreen, ack.server_time),
              );
            }
          }
        },
      );
    };

    const subscribe = () => {
      socket.emit(
        "screens:subscribe",
        {
          includeAll: true,
          screenIds: activeScreenId ? [activeScreenId] : [],
        },
        (ack?: ScreensSubscribeAck) => {
          setRejectedScreenIds(Array.isArray(ack?.rejected) ? ack.rejected : []);
        },
      );
    };

    const onConnect = () => {
      setIsConnected(true);
      subscribe();
      runSync();
      void refetchOverview();
      void refetchList();
      void refetchGroups();
      void refetchDetail();
    };

    const onReconnect = () => {
      setIsConnected(true);
      subscribe();
      runSync();
      void refetchOverview();
      void refetchList();
      void refetchGroups();
      void refetchDetail();
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = () => {
      setIsConnected(false);
      void refetchOverview();
      void refetchList();
      void refetchGroups();
      void refetchDetail();
    };

    const onStateUpdate = (payload: ScreenStateUpdateEvent) => {
      if (shouldSyncOverview) {
        queryClient.setQueryData(overviewQueryKey, (current: ReturnType<typeof patchScreenInOverview>) => {
          if (!current) return current;
          const existingScreens = current.screens ?? [];
          const hasExisting = existingScreens.some((item) => item.id === payload.screen.id);

          if (onlineOnly) {
            if (payload.screen.health_state !== "ONLINE") {
              return {
                ...current,
                server_time: payload.server_time ?? current.server_time,
                screens: existingScreens.filter((item) => item.id !== payload.screen.id),
              };
            }

            if (!hasExisting) {
              return {
                ...current,
                server_time: payload.server_time ?? current.server_time,
                screens: [payload.screen, ...existingScreens],
              };
            }
          }

          return patchScreenInOverview(current as never, payload.screen, payload.server_time);
        });
      } else {
        const shouldInvalidateList = shouldInvalidateFilteredScreensList(listRealtimeFilters, payload.screen);
        const patched =
          !shouldInvalidateList && listQueryKey
            ? queryClient.setQueryData(listQueryKey, (current: ReturnType<typeof patchScreenInPaginatedList>) =>
                patchScreenInPaginatedList(current as never, payload.screen, payload.server_time),
              )
            : undefined;
        if (shouldInvalidateList || !patched) {
          void refetchList();
        }
      }

      if (activeScreenId === payload.screen.id) {
        queryClient.setQueryData(detailQueryKey, (current: ReturnType<typeof patchScreenNowPlaying>) =>
          patchScreenNowPlaying(current as never, payload.screen, payload.server_time),
        );
      }

      handleStateUpdate?.(payload);
    };

    const onPreviewUpdate = (payload: ScreenPreviewUpdateEvent) => {
      if (shouldSyncOverview) {
        queryClient.setQueryData(
          overviewQueryKey,
          (current: ReturnType<typeof patchScreenPreviewInOverview>) =>
            patchScreenPreviewInOverview(current as never, payload),
        );
      }

      if (activeScreenId === payload.screenId) {
        queryClient.setQueryData(
          detailQueryKey,
          (current: ReturnType<typeof patchScreenPreviewInNowPlaying>) =>
            patchScreenPreviewInNowPlaying(current as never, payload),
        );
      }

      handlePreviewUpdate?.(payload);
    };

    const onRefreshRequired = (payload: ScreenRefreshRequiredEvent) => {
      handleRefreshRequired?.(payload);

      if (payload.reason === "EMERGENCY" && Array.isArray(payload.screen_ids)) {
        setPendingEmergencyScreenIds(payload.screen_ids);
      }

      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        const tasks: Array<Promise<unknown>> = [refetchOverview(), refetchList()];
        if (payload.reason !== "EMERGENCY" || (payload.group_ids?.length ?? 0) > 0) {
          tasks.push(refetchGroups());
        }
        if (shouldRefetchScreenDetail(payload, activeScreenId)) {
          tasks.push(refetchDetail());
        }

        void Promise.allSettled(tasks).finally(() => {
          if (payload.reason === "EMERGENCY" && Array.isArray(payload.screen_ids)) {
            setPendingEmergencyScreenIds((current) =>
              current.filter((screenId) => !payload.screen_ids?.includes(screenId)),
            );
          }
        });
      }, SCREENS_REFRESH_DEBOUNCE_MS);
    };

    socket.on("connect", onConnect);
    socket.on("reconnect", onReconnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("screens:state:update", onStateUpdate);
    socket.on("screens:preview:update", onPreviewUpdate);
    socket.on("screens:refresh:required", onRefreshRequired);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      socket.off("connect", onConnect);
      socket.off("reconnect", onReconnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("screens:state:update", onStateUpdate);
      socket.off("screens:preview:update", onPreviewUpdate);
      socket.off("screens:refresh:required", onRefreshRequired);
    };
  }, [
    activeScreenId,
    authToken,
    detailQueryKey,
    enabled,
    handlePreviewUpdate,
    handleRefreshRequired,
    handleStateUpdate,
    includePreview,
    groupsQueryKey,
    listQueryKey,
    listRealtimeFilters,
    onlineOnly,
    queryClient,
    syncMode,
  ]);

  return {
    isConnected,
    rejectedScreenIds,
    pendingEmergencyScreenIds,
  };
};
