const id = process.argv[2] ?? "";
const creds={keyId:process.env.RAZORPAY_KEY_ID??"",keySecret:process.env.RAZORPAY_KEY_SECRET??""};
const auth="Basic "+Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
const api=async(p:string)=>{const r=await fetch(`https://api.razorpay.com/v1${p}`,{headers:{authorization:auth}});return r.json() as Promise<any>;};
const l=await api(`/payment_links/${id}`);
console.log("=== RAZORPAY PAYMENT LINK NOTES ===");
console.log(JSON.stringify(l.notes, null, 2));
console.log("\nlink raised for:", l.amount, "paise   status:", l.status);
const payId=(l.payments??[])[0]?.payment_id;
if (payId) {
  const p=await api(`/payments/${payId}`);
  console.log("\n=== payment", payId, "===");
  console.log("captured:", p.amount, "paise   status:", p.status);
  console.log("payment notes:", JSON.stringify(p.notes));
  const o=await api(`/orders/${p.order_id}`);
  console.log("\n=== order", o.id, "===");
  console.log("amount:", o.amount, " offers:", JSON.stringify(o.offers));
  console.log("ORDER NOTES:", JSON.stringify(o.notes, null, 2));
}
