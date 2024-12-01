import SideBySideEditor from "@/components/custom/SideBySideEditor";

export default function Dashboard() {
  return (
    <div className="h-full w-full flex justify-center">
      <div className="container max-w-7xl h-full px-4 md:px-8">
        <SideBySideEditor />
      </div>
    </div>
  );
}
