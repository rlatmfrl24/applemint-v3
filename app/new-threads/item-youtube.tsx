import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";

export const YoutubeItem = ({ thread }: { thread: ThreadItemType }) => {
  return (
    <Card
      key={thread.id}
      className="cursor-pointer max-w-full w-full"
      onClick={() => {
        window.open(thread.url, "_blank");
      }}
    >
      <CardHeader className="flex flex-col gap-2">
        <CardTitle className="text-ellipsis overflow-hidden"></CardTitle>
      </CardHeader>
      <CardContent></CardContent>
    </Card>
  );
};
