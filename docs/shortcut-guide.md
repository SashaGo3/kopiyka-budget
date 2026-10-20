# Setting up the notification Shortcut

Your bank already notifies you about every card payment. A Shortcuts automation can hand that notification to Kopiyka, which reads the amount and the shop on the phone and logs the payment. It needs iOS 27. You set it up once.

The simulator the pictures come from has no bank app, so Messages stands in for it.

## 1. Shortcuts → +

Open Shortcuts and tap + at the bottom. If it asks you to describe a shortcut, tap Edit.

<p class="guide-shots"><img src="img/guide/en/01.webp" width="300" height="652" loading="lazy" alt="Step 1"><img src="img/guide/en/02.webp" width="300" height="652" loading="lazy" alt="Step 1"></p>

## 2. Automation → Notification

Tap Automation under the search field, then search for Notification.

<p class="guide-shots"><img src="img/guide/en/03.webp" width="300" height="652" loading="lazy" alt="Step 2"><img src="img/guide/en/04.webp" width="300" height="652" loading="lazy" alt="Step 2"></p>

## 3. Pick your bank’s app

Tap App and search for it. No bank notifications? Pick Wallet (Apple Pay); + adds a second app.

<p class="guide-shots"><img src="img/guide/en/05.webp" width="300" height="652" loading="lazy" alt="Step 3"><img src="img/guide/en/06.webp" width="300" height="652" loading="lazy" alt="Step 3"></p>

## 4. Filter: Message contains a word

Add Filter, change Title to Message, and type a word every payment notification has, like “Amount”.

<p class="guide-shots"><img src="img/guide/en/07.webp" width="300" height="652" loading="lazy" alt="Step 4"><img src="img/guide/en/08.webp" width="300" height="652" loading="lazy" alt="Step 4"><img src="img/guide/en/09.webp" width="300" height="652" loading="lazy" alt="Step 4"></p>

## 5. Let it run on its own

Tap the arrow beside the app: keep Automation on and Notify off.

<p class="guide-shots"><img src="img/guide/en/10.webp" width="300" height="652" loading="lazy" alt="Step 5"></p>

## 6. Add “Log payment from an app notification”

Search for Kopiyka in the field at the bottom.

<p class="guide-shots"><img src="img/guide/en/11.webp" width="300" height="652" loading="lazy" alt="Step 6"></p>

## 7. Put Notification in its field

Tap Notification, then Select Variable, then the Notification under the trigger.

<p class="guide-shots"><img src="img/guide/en/12.webp" width="300" height="652" loading="lazy" alt="Step 7"><img src="img/guide/en/13.webp" width="300" height="652" loading="lazy" alt="Step 7"><img src="img/guide/en/14.webp" width="300" height="652" loading="lazy" alt="Step 7"></p>

## 8. Optional: where you paid

Tap the arrow, then Location → Choose → Current Location → ✓. Leave Account empty: Kopiyka picks it from the card or the currency.

<p class="guide-shots"><img src="img/guide/en/15.webp" width="300" height="652" loading="lazy" alt="Step 8"><img src="img/guide/en/16.webp" width="300" height="652" loading="lazy" alt="Step 8"></p>

## 9. Tap ‹ and you’re done

It saves itself. You’ll find it in Library → Automation, where its switch turns it off.

<p class="guide-shots"><img src="img/guide/en/17.webp" width="300" height="652" loading="lazy" alt="Step 9"><img src="img/guide/en/18.webp" width="300" height="652" loading="lazy" alt="Step 9"></p>

Then pay for something. A shop you have filed before files itself; a new one waits in Pending for a look. Notifications it cannot read are kept in Settings → Shortcut settings → Notification log, so the wording can be taught later.
