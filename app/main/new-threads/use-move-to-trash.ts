import {
    type InfiniteData,
    type QueryKey,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

interface ThreadsPage {
    items: ThreadItemType[];
    nextCursor: string | null;
}

type MutationContext = {
    previousStates: Array<{
        queryKey: QueryKey;
        data: InfiniteData<ThreadsPage> | undefined;
    }>;
};

const isNewThreadsInfiniteQueryKey = (queryKey: QueryKey) => {
    return Array.isArray(queryKey) && queryKey.length > 0 &&
        queryKey[0] === "new-threads" &&
        queryKey[queryKey.length - 1] !== "stats";
};

const normalizeId = (value: string | number) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }

    const stringValue = String(value);
    const trimmedValue = stringValue.trim();

    if (/^[+-]?\d+$/.test(trimmedValue)) {
        return String(Number.parseInt(trimmedValue, 10));
    }

    return stringValue;
};

const removeThreadFromInfiniteData = (
    data: InfiniteData<ThreadsPage>,
    threadId: string,
): InfiniteData<ThreadsPage> => {
    const normalizedId = normalizeId(threadId);
    let removed = false;

    const nextPages = data.pages.map((page) => {
        let pageRemoved = false;

        const filteredItems = page.items.filter((item) => {
            const currentId = normalizeId(item.id);
            const shouldKeep = currentId !== normalizedId;
            if (!shouldKeep) {
                pageRemoved = true;
            }
            return shouldKeep;
        });

        if (!pageRemoved) {
            return page;
        }

        removed = true;
        return { ...page, items: filteredItems };
    });

    if (!removed) {
        return data;
    }

    return {
        ...data,
        pages: nextPages,
    };
};

export const useMoveThreadToTrash = (thread: ThreadItemType) => {
    const supabase = createClient();
    const queryClient = useQueryClient();

    return useMutation<string, unknown, string, MutationContext>({
        mutationFn: async (threadId) => {
            const parsedId = Number.parseInt(threadId, 10);
            const deleteIdentifier = Number.isNaN(parsedId)
                ? threadId
                : parsedId;

            const { error: deleteError } = await supabase
                .from("new-threads")
                .delete()
                .eq("id", deleteIdentifier);

            if (deleteError) {
                throw deleteError;
            }

            const { error: trashError } = await supabase.from("trash").insert([
                {
                    type: thread.type,
                    url: thread.url,
                    title: thread.title,
                    description: thread.description,
                    host: thread.host,
                },
            ]);

            if (trashError) {
                throw trashError;
            }

            return threadId;
        },
        onMutate: async (threadId) => {
            await queryClient.cancelQueries({
                predicate: (query) =>
                    isNewThreadsInfiniteQueryKey(query.queryKey),
            });

            const affectedQueries = queryClient
                .getQueryCache()
                .findAll({
                    predicate: (query) =>
                        isNewThreadsInfiniteQueryKey(query.queryKey),
                });

            const previousStates = affectedQueries.map((query) => {
                const data = query.state.data as
                    | InfiniteData<ThreadsPage>
                    | undefined;
                if (data) {
                    queryClient.setQueryData(
                        query.queryKey,
                        removeThreadFromInfiniteData(data, threadId),
                    );
                }

                return { queryKey: query.queryKey, data };
            });

            return { previousStates };
        },
        onSuccess: (_, __, context) => {
            toast.success("스레드를 휴지통으로 이동했습니다.");

            if (thread.type !== "media" && thread.type !== "youtube") {
                void queryClient.invalidateQueries({
                    queryKey: ["new-threads", "normal", "stats"],
                });
            }

            return context;
        },
        onError: (error, _threadId, context) => {
            context?.previousStates.forEach(({ queryKey, data }) => {
                queryClient.setQueryData(queryKey, data);
            });

            console.error("신규 스레드 휴지통 이동 실패", error);
            toast.error("스레드 이동 중 오류가 발생했습니다.");
        },
    });
};
