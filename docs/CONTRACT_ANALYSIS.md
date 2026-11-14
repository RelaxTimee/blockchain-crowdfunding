# การวิเคราะห์ CrowdfundingMilestone

แหล่งอ้างอิง: [Verified source และ ABI บน Etherscan](https://sepolia.etherscan.io/address/0x7AdC7237D1E4aC47C8E315e10711428c431bAF6B#code)

Source ระบุ `pragma solidity ^0.8.26` และ Etherscan แสดง compiler `v0.8.26+commit.8a97fa7a` สำเนาใน `contracts/` ดึงจากหน้าเดียวกัน ไม่ได้สร้าง ABI จากการเดาฟังก์ชัน Source/ABI hashes และข้อมูลจริงขณะตรวจอยู่ใน `sepolia-check.json` (เป็น snapshot ไม่ใช่ค่าปัจจุบันตลอดเวลา)

## State และข้อมูล

| State                                 | ความหมาย                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `campaignCount`                       | จำนวนโครงการและ ID ล่าสุด; เริ่มนับจาก 1                                                                                   |
| `approvalPercent`                     | constant เท่ากับ 50; เงื่อนไขผ่านใช้ `>`                                                                                    |
| `Campaign`                            | `campaignId`, `creator`, `name`, `goal`, `deadline`, `totalRaised`, `totalReleased`, `totalRefunded`, `releasedCount` |
| `Milestone`                           | `description`, `percent`, `evidence`, `approvalWeight`, `amountReleased`, `status`                                    |
| `MilestoneStatus`                     | `Pending = 0`, `Requested = 1`, `Released = 2`                                                                        |
| `contributions[campaignId][wallet]`   | ETH สะสมของแต่ละผู้สนับสนุน; เป็น 0 หลังคืนเงิน                                                                                |
| `hasVoted[campaignId][index][wallet]` | ป้องกันลงคะแนนซ้ำต่อระยะงาน                                                                                               |

จำนวนเงินทุกตัวเป็น wei; deadline เป็น Unix timestamp วินาที; create duration เป็น **นาที**; index ของ Milestone เริ่มที่ 0

## Write functions ทั้งหมด

| Function           | Arguments / value                                                               | เงื่อนไขและผลลัพธ์                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createCampaign`   | `string name, uint goal, uint durationMinutes, string[] descs, uint[] percents` | ชื่อไม่ว่าง, เป้า/นาที > 0, 1–10 ระยะ, arrays ยาวเท่ากัน, สัดส่วนแต่ละระยะ > 0 และรวม 100; เพิ่ม ID และบันทึก creator            |
| `contribute`       | `uint campaignId`; payable `msg.value`                                          | ห้าม creator, ยังไม่พ้น deadline, ETH > 0; เพิ่ม contribution และ totalRaised                                           |
| `requestRelease`   | `uint campaignId, uint index, string evidence`                                  | เฉพาะ creator, หมดเวลาแล้ว, ถึงเป้า, Pending, index = releasedCount, หลักฐานไม่ว่าง; เปลี่ยนเป็น Requested                 |
| `approveMilestone` | `uint campaignId, uint index`                                                   | ผู้สนับสนุนที่ contribution > 0, Requested, ยังไม่โหวต; เพิ่ม approvalWeight และโอนเงินเมื่อ `weight * 100 > totalRaised * 50` |
| `refund`           | `uint campaignId`                                                               | หมดเวลาแล้ว, ไม่ถึงเป้า, contribution > 0; เคลียร์ contribution ก่อนโอน และเพิ่ม totalRefunded                             |

ไม่มี public `withdraw`, `releaseMilestone` หรือ admin approval การจ่ายเรียก internal ใน `approveMilestone` เท่านั้น

## Read functions ทั้งหมด

| Function                      | ผลลัพธ์                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `campaignCount()`             | จำนวนโครงการ                                           |
| `approvalPercent()`           | เกณฑ์โหวต 50                                            |
| `getCampaign(id)`             | Campaign tuple                                         |
| `getMilestones(id)`           | Milestone tuple array                                  |
| `getMilestone(id, index)`     | Milestone เดียว                                         |
| `getProgress(id)`             | raised, goal, percent (integer), timeLeft, goalReached |
| `getContribution(id, wallet)` | ยอด contribution ปัจจุบัน                                 |
| `contributions(id, wallet)`   | auto getter ของ mapping เดียวกัน                         |
| `hasVoted(id, index, wallet)` | เคยโหวตแล้วหรือไม่                                        |
| `getContractBalance()`        | ETH balance รวมทุกโครงการ                               |

## Events ทั้งหมด

| Event                | Fields                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `CampaignCreated`    | campaignId indexed, creator indexed, goal, deadline                |
| `Contributed`        | campaignId indexed, backer indexed, amount                         |
| `MilestoneRequested` | campaignId indexed, milestoneIndex indexed, evidence               |
| `MilestoneApproved`  | campaignId indexed, milestoneIndex indexed, backer indexed, weight |
| `FundsReleased`      | campaignId indexed, milestoneIndex indexed, to indexed, amount     |
| `Refunded`           | campaignId indexed, backer indexed, amount                         |

UI filter ด้วย indexed campaign ID และใช้ `(transactionHash, logIndex)` แยกแต่ละรายการในธุรกรรมเดียวกัน `MilestoneApproved` อาจตามด้วย `FundsReleased` ใน transaction เดียว

## สูตรการเงินและข้อควรระวัง

- จ่ายระยะปกติ = `totalRaised * percent / 100` ปัดลงระดับ wei
- จ่ายระยะสุดท้าย = `totalRaised - totalReleased` เพื่อเก็บเศษปัดครบ
- คงเหลือโครงการ = `totalRaised - totalReleased - totalRefunded`
- `totalRaised` เป็นยอดสะสมตลอดโครงการ ไม่ลดลงหลังคืนเงิน จึงต้องแสดง `totalRefunded` แยก
- เปอร์เซ็นต์ระดมทุนอาจมากกว่า 100%; UI แสดงค่าจริง แต่ความกว้าง progress bar จำกัด 100%
- การโอน ETH เปลี่ยน state ก่อน external call และ revert ทั้งรายการเมื่อโอนไม่สำเร็จ

## ข้อจำกัดของ backend ที่ frontend แก้ไม่ได้

1. ไม่มี reject vote, voting deadline, dispute, cancellation, emergency withdrawal หรือ refund เมื่อถึงเป้าหมายแล้วแต่เจ้าของไม่ดำเนินการ/ผู้สนับสนุนไม่โหวต เงินอาจค้างใน Contract
2. หาก creator เป็น smart contract ที่รับ ETH ไม่ได้ การอนุมัติที่ทำให้ผ่านเกณฑ์จะ revert รวมการโหวตนั้น
3. Evidence เป็น string สาธารณะ ไม่มีการยืนยันความถูกต้องของผลงานหรือเก็บไฟล์ ต้องแนบข้อความ/URI จากภายนอก ผู้สนับสนุนตรวจเองก่อนโหวต
4. ไม่มี edit campaign หรือ edit evidence หลังส่ง request; UI แจ้งข้อมูลแก้ไขไม่ได้ก่อนสร้าง
5. ระบบไม่จำกัดยอดเงินที่บริจาคเมื่อถึง goal; การจ่ายคิดจากยอดที่ระดมได้จริงทั้งหมด
6. การอ่านทุกโครงการและประวัติทั้งหมดอาจใช้ RPC มาก UI จึงแบ่งหน้า/แบ่งช่วงและแสดงขอบเขตข้อมูลที่ตรวจแล้ว

ข้อจำกัดเหล่านี้ไม่ขัดกับฟังก์ชันทั้ง 7 ข้อใน PDF แต่ควรเพิ่มใน smart contract รุ่นใหม่ก่อนใช้กับเงินจริง ไม่สามารถอ้างว่าการสร้าง frontend เป็น security audit ของ backend ได้
