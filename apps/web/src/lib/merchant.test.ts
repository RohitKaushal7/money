import { describe, expect, test } from "bun:test";
import { cleanMerchant } from "./merchant";

describe("cleanMerchant", () => {
	test("a well-known merchant gets its own spelling, whatever surrounds it", () => {
		expect(cleanMerchant("SWIGGY ORDER BLR")).toBe("Swiggy");
		expect(cleanMerchant("ZOMATO ONLINE ORDER")).toBe("Zomato");
		expect(cleanMerchant("BIGBASKET ORDER")).toBe("BigBasket");
		expect(cleanMerchant("GOOGLE PLAY STORE")).toBe("Google Play");
		expect(cleanMerchant("IRCTC RAIL TICKET")).toBe("IRCTC");
		expect(cleanMerchant("CRED CCBP SBICARD PAYMENT")).toBe("CRED");
	});

	test("the brand that comes first wins", () => {
		expect(cleanMerchant("SWIGGY INSTAMART")).toBe("Swiggy");
	});

	test("brands match whole words only", () => {
		// CRED is not inside CREDIT, OLA is not inside COLA
		expect(cleanMerchant("INTEREST CREDIT SB ACCOUNT")).toBe(
			"Interest Credit SB Account",
		);
		expect(cleanMerchant("COCA COLA DEPOT")).toBe("Coca Cola Depot");
	});

	test("a UPI narration yields the payee", () => {
		expect(cleanMerchant("UPI/CHAIWALA/PAY")).toBe("Chaiwala");
		expect(
			cleanMerchant(
				"TO TRANSFER-UPI/DR/412345678901/CHAIWALA/YESB/paytmqr28@paytm/Payment--",
			),
		).toBe("Chaiwala");
		expect(
			cleanMerchant(
				"BY TRANSFER-UPI/CR/512345678901/RAHUL KUMAR/SBIN/rk@oksbi/UPI",
			),
		).toBe("Rahul Kumar");
	});

	test("a UPI payee that is a known brand gets the brand", () => {
		expect(
			cleanMerchant("UPI/DR/412345678901/SWIGGY LIMITED/HDFC/swiggy@hdfc/Pay"),
		).toBe("Swiggy");
	});

	test("NEFT payee, without the IFSC, the reference or the company suffix", () => {
		expect(
			cleanMerchant(
				"BY TRANSFER-NEFT*HDFC0000001*N123456789*ACME TECH PVT LTD--",
			),
		).toBe("Acme Tech");
	});

	test("ATM withdrawals read as one", () => {
		expect(cleanMerchant("ATM WDL SBI ATM")).toBe("ATM withdrawal");
	});

	test("anything else is the narration in title case, acronyms kept", () => {
		expect(cleanMerchant("SALARY CREDIT ACME TECHNOLOGIES")).toBe(
			"Salary Credit Acme Technologies",
		);
		expect(cleanMerchant("RENT PAYMENT TO LANDLORD")).toBe(
			"Rent Payment to Landlord",
		);
		expect(cleanMerchant("SMS CHARGES GST")).toBe("SMS Charges GST");
		expect(cleanMerchant("MONTHLY INTEREST PAYOUT FD BOND")).toBe(
			"Monthly Interest Payout FD Bond",
		);
	});

	test("long reference numbers are dropped", () => {
		expect(cleanMerchant("CHQ DEP 000123456789 LOCAL")).toBe("Chq Dep Local");
	});

	test("a rail with no name-like segment falls back to the whole narration", () => {
		expect(cleanMerchant("UPI/DR/412345678901")).toBe("UPI Dr");
	});

	test("never empty for a non-empty narration", () => {
		expect(cleanMerchant("123456789012")).toBe("123456789012");
		expect(cleanMerchant("   ")).toBe("");
	});
});
