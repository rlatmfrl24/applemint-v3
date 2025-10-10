import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

const ISSUELINK_SCOPE = "issuelink" as const;
const MEDIA_SCOPE = "media" as const;
const YOUTUBE_SCOPE = "youtube" as const;

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { searchParams } = new URL(request.url);
        const scope = searchParams.get("scope") ?? "normal";
        const filterType = searchParams.get("filterType");
        const issuelinkCategory = searchParams.get("issuelinkCategory");

        const query = supabase.from("new-threads").select("type, tag");

        if (scope === "normal") {
            query
                .neq("type", MEDIA_SCOPE)
                .neq("type", YOUTUBE_SCOPE);
        }

        if (filterType) {
            if (filterType === ISSUELINK_SCOPE) {
                query.eq("type", ISSUELINK_SCOPE);
                if (issuelinkCategory) {
                    query.eq("tag->>1", issuelinkCategory);
                }
            } else {
                query.eq("type", filterType);
            }
        }

        const { data, error } = await query;

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const rows = data ?? [];

        const counts = rows.reduce(
            (
                acc: Record<
                    string,
                    { key: string; label: string; count: number }
                >,
                row: { type: string; tag: string[] | null },
            ) => {
                const isIssuelink = row.type === ISSUELINK_SCOPE;
                const key = isIssuelink
                    ? `${ISSUELINK_SCOPE}::${row.tag?.[1] ?? "unknown"}`
                    : row.type;
                const label = isIssuelink
                    ? row.tag?.[1] ?? "unknown"
                    : row.type;

                if (!acc[key]) {
                    acc[key] = { key, label, count: 0 };
                }

                acc[key].count += 1;
                return acc;
            },
            {},
        );

        const sortedCounts = Object.values(counts).sort((a, b) =>
            b.count - a.count
        );
        const totalCount = rows.length;

        return NextResponse.json({
            scope,
            totalCount,
            counts: sortedCounts,
        });
    } catch (error) {
        console.error("신규 스레드 통계 조회 실패", error);
        return NextResponse.json(
            { error: "신규 스레드 통계 조회에 실패했습니다." },
            { status: 500 },
        );
    }
}
