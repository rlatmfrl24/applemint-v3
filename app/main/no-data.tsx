import { Card } from "@/components/ui/card";

export default function NoDataBox() {
	return (
		<Card className="flex flex-col items-center justify-center h-full w-full py-6">
			<h3>No Data</h3>
			<span className="text-gray-500">No data to display</span>
		</Card>
	);
}
