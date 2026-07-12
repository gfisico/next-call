import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 後続ユニットが差し替えるプレースホルダー（本ユニットの Boundaries: 画面実装はしない） */
export function PlaceholderCard({
  title,
  unit,
}: {
  title: string;
  unit: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-muted-foreground">
          この画面は {unit} で実装されます。
        </p>
      </CardContent>
    </Card>
  );
}
