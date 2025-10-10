import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThreadItemType } from "@/lib/typeDefs";
import NoDataBox from "../no-data";
import { QuickSaveButton } from "../quick-save-button";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";

interface ThreadStatsItem {
  key: string;
  label: string;
  count: number;
}

const TypeStats = ({
  stats,
  selectedType,
  onTypeChange,
}: {
  stats: ThreadStatsItem[] | undefined;
  selectedType: string;
  onTypeChange: (type: string) => void;
}) => {
  const totalCount = stats?.reduce((acc, type) => acc + type.count, 0) ?? 0;

  return (
    <Card className="mb-1">
      <CardHeader>
        <ToggleGroup
          type="single"
          value={selectedType}
          onValueChange={(value) => {
            if (!value) return;
            onTypeChange(value);
          }}
        >
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <ToggleGroupItem
              value="all"
              className="flex justify-between"
              disabled={!stats}
            >
              <span className="font-medium text-sm md:text-xl">All</span>
              <Badge>{stats ? totalCount : "-"}</Badge>
            </ToggleGroupItem>
            {stats?.map((type) => (
              <ToggleGroupItem
                key={type.key}
                value={type.key}
                className="flex justify-between"
              >
                <span className="font-medium text-sm md:text-lg">
                  {type.label}
                </span>
                <Badge>{type.count}</Badge>
              </ToggleGroupItem>
            ))}
          </div>
        </ToggleGroup>
      </CardHeader>
    </Card>
  );
};

const ThreadList = ({ threads }: { threads: ThreadItemType[] }) => {
  return (
    <AnimatePresence>
      {threads.map((thread) => (
        <motion.div
          key={thread.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
        >
          <DefaultThreadItem
            thread={thread}
            threadName="new-threads"
            extraButtons={<QuickSaveButton thread={thread} />}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  );
};

export const NormalThreads = ({ isActive }: { isActive: boolean }) => {
  const [selectedType, setSelectedType] = useState("all");

  const filterParams = useMemo(() => {
    const params: { key: string; value: string }[] = [];

    if (selectedType !== "all") {
      if (selectedType.startsWith("issuelink::")) {
        const category = selectedType.split("::")[1] ?? "";
        params.push({ key: "filterType", value: "issuelink" });
        if (category) {
          params.push({ key: "issuelinkCategory", value: category });
        }
      } else {
        params.push({ key: "filterType", value: selectedType });
      }
    }

    return params;
  }, [selectedType]);

  const fetchThreads = useCallback(
    async ({ pageParam }: { pageParam?: string }) => {
      const searchParams = new URLSearchParams({
        scope: "normal",
        limit: "24",
      });

      if (pageParam) {
        searchParams.set("cursor", pageParam);
      }

      for (const { key, value } of filterParams) {
        searchParams.set(key, value);
      }

      const response = await fetch(
        `/api/new-threads?${searchParams.toString()}`
      );

      if (!response.ok) {
        throw new Error("신규 스레드 데이터를 불러오지 못했습니다.");
      }

      return (await response.json()) as {
        items: ThreadItemType[];
        nextCursor: string | null;
      };
    },
    [filterParams]
  );

  const fetchStats = useCallback(async () => {
    const response = await fetch(`/api/new-threads/stats?scope=normal`);

    if (!response.ok) {
      throw new Error("신규 스레드 통계를 불러오지 못했습니다.");
    }

    return (await response.json()) as {
      counts: ThreadStatsItem[];
    };
  }, []);

  const filterKey = useMemo(
    () => filterParams.map(({ key, value }) => `${key}:${value}`).join("|"),
    [filterParams]
  );

  const statsQuery = useQuery({
    queryKey: ["new-threads", "normal", "stats"],
    queryFn: fetchStats,
    staleTime: 1000 * 60 * 5,
    enabled: isActive,
  });

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ["new-threads", "normal", filterKey],
    queryFn: ({ pageParam }) => fetchThreads({ pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    enabled: isActive,
  });

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void refetch({ refetchPage: (_, index) => index === 0 });
  }, [filterKey, isActive, refetch]);

  const threads = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  );

  const filteredThreads = useMemo(() => threads, [threads]);

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
            console.error("신규 스레드 추가 로드 실패", loadError);
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

  useEffect(() => {
    if (!isActive || typeof window === "undefined") {
      return;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectedType, isActive]);

  if (!isActive) {
    return null;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>에러 발생</AlertTitle>
        <AlertDescription>
          데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {statsQuery.data?.counts && statsQuery.data.counts.length > 0 && (
        <TypeStats
          stats={statsQuery.data.counts}
          selectedType={selectedType}
          onTypeChange={setSelectedType}
        />
      )}
      {isLoading ? (
        <div className="space-y-4">
          <ThreadLoading />
          <ThreadLoading />
          <ThreadLoading />
        </div>
      ) : filteredThreads.length === 0 ? (
        <NoDataBox />
      ) : (
        <ThreadList threads={filteredThreads} />
      )}
      <div ref={loadMoreRef} className="h-6 w-full" />
      {(isFetching || isFetchingNextPage) && <ThreadLoading count={2} />}
    </div>
  );
};
