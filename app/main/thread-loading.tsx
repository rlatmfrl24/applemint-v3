import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const ThreadLoading = () => {
  return (
    <div className="space-y-2 pt-2">
      <Card>
        <CardContent className="space-y-2 mt-6">
          <Skeleton className="h-5 w-[250px] rounded-xl" />
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 mt-6">
          <Skeleton className="h-5 w-[250px] rounded-xl" />
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 mt-6">
          <Skeleton className="h-5 w-[250px] rounded-xl" />
          <Skeleton className="h-4 w-[250px]" />
          <Skeleton className="h-4 w-[200px]" />
        </CardContent>
      </Card>
    </div>
  );
};
