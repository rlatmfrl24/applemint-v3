import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
    const queries = request.nextUrl.searchParams;
    const collectionId = queries.get("id");

    const collectionResponse = await fetch(
        `https://api.raindrop.io/rest/v1/tags/${collectionId}`,
        {
            headers: {
                Authorization:
                    `Bearer ${process.env.NEXT_PUBLIC_RAINDROP_ACCESS_TOKEN}`,
            },
        },
    );
    const collectionData = await collectionResponse.json();
    const collections = collectionData.items.map((item: any) => {
        return {
            id: item._id,
            title: item.title,
            count: item.count,
        };
    });

    return new Response(JSON.stringify(collections), {
        status: 200,
    });
}
