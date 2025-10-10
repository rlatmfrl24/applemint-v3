import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { MediaItemType } from "@/lib/typeDefs";
import NoDataBox from "../no-data";
import { ThreadLoading } from "../thread-loading";
import { MediaItem } from "./item-media";

export const MediaThreads = ({ isActive }: { isActive: boolean }) => {
  const fetchMediaThreads = useCallback(
    async ({ pageParam }: { pageParam?: string }) => {
      const searchParams = new URLSearchParams({ scope: "media", limit: "24" });
      if (pageParam) {
        searchParams.set("cursor", pageParam);
      }

      const response = await fetch(
        `/api/new-threads?${searchParams.toString()}`
      );
      if (!response.ok) {
        throw new Error("미디어 스레드 데이터를 불러오지 못했습니다.");
      }

      return (await response.json()) as {
        items: MediaItemType[];
        nextCursor: string | null;
      };
    },
    []
  );

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ["new-threads", "media"],
    queryFn: ({ pageParam }) => fetchMediaThreads({ pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    enabled: isActive,
  });

  const mediaThreads = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  );

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const handleLoadMore = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }

    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (
      !isActive ||
      typeof window === "undefined" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          handleLoadMore().catch((loadError) => {
            console.error("미디어 스레드 추가 로드 실패", loadError);
          });
        }
      });
    });

    const currentObserver = observerRef.current;
    const element = loadMoreRef.current;

    if (element) {
      currentObserver.observe(element);
    }

    return () => {
      currentObserver.disconnect();
    };
  }, [handleLoadMore, isActive]);

  if (!isActive) {
    return null;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-4 w-full">
        <AlertTitle>에러 발생</AlertTitle>
        <AlertDescription>
          미디어 스레드를 불러오는 중 오류가 발생했습니다.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex max-w-full flex-col-reverse gap-2 md:flex-row">
      {!isLoading && mediaThreads.length === 0 ? (
        <NoDataBox />
      ) : (
        <div className="flex w-full flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
          {isLoading && <ThreadLoading />}
          <AnimatePresence>
            {mediaThreads.map((thread) => (
              <MediaItem
                key={thread.id}
                thread={thread}
                onClick={async (item) => {
                  window.open(item.url, "_blank");
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
      <div ref={loadMoreRef} className="h-6 w-full" />
      {(isFetching || isFetchingNextPage) && <ThreadLoading count={2} />}
    </div>
  );
};
