import { Suspense } from "react";
import AdminPatternGate from "@/components/pages/admin/AdminGatePageComponent";

export const dynamic = "force-dynamic";

export default function AdminLogin() {
  return (
    <div className="ag-root">
      <div className="ag-wrap ag-wrap--narrow" style={{ paddingTop: 72 }}>
        <div className="ag-mono">Agreement · Admin</div>
        <h1 className="ag-h1" style={{ fontSize: 34 }}>管理入口</h1>
        <p className="ag-sub" style={{ marginTop: 12 }}>画两个不同的手势，两个都对才解锁。</p>

        <Suspense fallback={null}>
          <AdminPatternGate />
        </Suspense>
      </div>
    </div>
  );
}
