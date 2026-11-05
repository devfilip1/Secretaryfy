import { Card } from "@/components/ui/card";
import { CenterPage } from "../components/CenterPage";
import { Title } from "../components/Title";

export function Disabled() {
  return (
    <CenterPage>
      <Card className="w-[min(420px,100%)]">
        <Title level={1} className="mb-1">
          Panel disabled
        </Title>
        <p className="my-4">
          Set <code>OPERATOR_PASSWORD</code> (12 characters or more) in the server <code>.env</code> and restart it.
        </p>
      </Card>
    </CenterPage>
  );
}
