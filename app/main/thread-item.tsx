import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo } from "react";

export const DefaultThreadItem = ({
  thread,
  threadName,
  extraButtons,
  disablePrimaryAction,
}: {
  thread: ThreadItemType;
  threadName: string;
  extraButtons?: React.ReactNode;
  disablePrimaryAction?: boolean;
}) => {
  const queryClient = useQueryClient();

  const removeThread = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error: DeleteError } = await supabase
        .from(threadName)
        .delete()
        .eq("id", parseInt(id));
      if (DeleteError) {
        console.error("🚀 ~ removeThread ~ error", DeleteError);
        return;
      }

      const { error: TrashInsertError } = await supabase.from("trash").insert([
        {
          type: thread.type,
          url: thread.url,
          title: thread.title,
          description: thread.description,
          host: thread.host,
        },
      ]);

      if (TrashInsertError) {
        console.error("🚀 ~ removeThread ~ error", TrashInsertError);
        return;
      }
    },
    onSettled: async () => {
      return await queryClient.invalidateQueries({
        queryKey: [threadName],
      });
    },
  });

  return (
    <motion.div
      key={thread.id}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
    >
      <Card
        className="cursor-pointer max-w-full w-full
          hover:bg-zinc-200 dark:hover:bg-zinc-900
           transition-colors duration-200"
        onClick={() => {
          window.open(thread.url, "_blank");
        }}
      >
        <CardHeader className="max-w-full">
          <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.title}
          </CardTitle>
          <CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.url}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-2 items-center justify-between">
          {disablePrimaryAction ? null : (
            <Button
              size={`sm`}
              disabled={removeThread.isPending}
              onClick={async (e) => {
                e.stopPropagation();
                removeThread.mutate(thread.id);
              }}
            >
              {!removeThread.isPending ? (
                "Delete"
              ) : (
                <Loader2 className="animate-spin" />
              )}
            </Button>
          )}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {extraButtons}
            {!disablePrimaryAction && <RaindropSheet thread={thread} />}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

const formSchema = z.object({
  title: z.string(),
  description: z.string(),
  url: z.string(),
  tags: z.array(z.string()),
});

const RaindropSheet = ({ thread }: { thread: ThreadItemType }) => {
  const form = useForm<z.infer<typeof formSchema>>({
    defaultValues: {
      title: thread.title,
      description: thread.description,
      url: thread.url,
      tags: [],
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    console.log("🚀 ~ data", data);
  }

  return (
    <Sheet>
      <SheetTrigger>
        <Button size={`sm`} variant={`ghost`}>
          Go to Raindrop
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add Raindrop</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags</FormLabel>
                  <div className="flex gap-2 flex-wrap">
                    {form.getValues().tags.map((tag, index) => (
                      <Badge
                        key={index}
                        className="cursor-pointer select-none"
                        onClick={() => {
                          form.setValue(
                            "tags",
                            form.getValues().tags.filter((t) => t !== tag)
                          );
                        }}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <Input
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.currentTarget.value === "") return;
                        if (
                          form.getValues().tags.includes(e.currentTarget.value)
                        )
                          return;

                        form.setValue("tags", [
                          ...form.getValues().tags,
                          e.currentTarget.value,
                        ]);
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </FormItem>
              )}
            />
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};
