import { Card } from "@/components/ui/card";

export default function NoDataBox() {
	return (
		<Card className="flex h-full w-full flex-col items-center justify-center py-6">
			<h3>No Data</h3>
			<span className="text-gray-500">No data to display</span>
		</Card>
	);
}
