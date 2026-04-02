export const PV_ORDER_ROW_STATUSES = ["DA_ORDINARE", "EVASO"] as const;
export type PvOrderRowStatus = (typeof PV_ORDER_ROW_STATUSES)[number];

export const PV_ORDER_SHIPPING_STATUSES = [
  "NON_SPEDITO",
  "PARZIALE",
  "SPEDITO",
] as const;
export type PvOrderShippingStatus = (typeof PV_ORDER_SHIPPING_STATUSES)[number];

export const PV_ORDER_STATUSES = ["DA_COMPLETARE", "COMPLETO"] as const;
export type PvOrderStatus = (typeof PV_ORDER_STATUSES)[number];

export type PvOrderSaveRow = {
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
};

export type PvOrderHeaderDb = {
  id: string;
  pv_id: string;
  order_date: string;
  operatore: string;
  created_by_username: string | null;
  shipping_status: PvOrderShippingStatus;
  created_at: string;
  updated_at: string;
};

export type PvOrderRowDb = {
  id: string;
  order_id: string;
  item_id: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
  row_status: PvOrderRowStatus;
  created_at: string;
  updated_at: string;
};

export type PvOrderListRow = {
  id: string;
  pv_id: string;
  order_date: string;
  operatore: string;
  created_by_username: string | null;
  shipping_status: PvOrderShippingStatus;
  created_at: string;
  updated_at: string;
  pv_code: string;
  pv_name: string;
  order_status: PvOrderStatus;
  total_rows: number;
  pending_rows: number;
  evaded_rows: number;
};

export type PvOrderDetailRow = {
  id: string;
  order_id: string;
  item_id: string;
  item_code: string;
  item_description: string;
  qty: number;
  qty_ml: number;
  qty_gr: number;
  row_status: PvOrderRowStatus;
  created_at: string;
  updated_at: string;
};

export type PvOrderDetail = {
  header: PvOrderHeaderDb & {
    pv_code: string;
    pv_name: string;
    order_status: PvOrderStatus;
    total_rows: number;
    pending_rows: number;
    evaded_rows: number;
  };
  rows: PvOrderDetailRow[];
};