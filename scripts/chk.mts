const id = process.argv[2] ?? "";
const c={keyId:process.env.RAZORPAY_KEY_ID??"",keySecret:process.env.RAZORPAY_KEY_SECRET??""};
const auth="Basic "+Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
const r=await fetch(`https://api.razorpay.com/v1/payment_links/${id}`,{headers:{authorization:auth}});
const b:any=await r.json();
console.log(`  ${id}  status=${b.status}  cancelled_at=${b.cancelled_at}`);
