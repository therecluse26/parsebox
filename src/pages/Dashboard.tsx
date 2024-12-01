import SideBySideEditor from "@/components/custom/SideBySideEditor";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const [isLoading, setIsLoading] = useState(false);

  // useEffect(() => {
  //   setIsLoading(processingLoading);
  // }, [processingLoading]);

  return (
    <>
      <div className="flex-grow flex flex-col">
        <div className="container px-4 md:px-8 flex-grow flex flex-col">
          <div>
            <SideBySideEditor />
          </div>
        </div>
      </div>
    </>
  );
}
