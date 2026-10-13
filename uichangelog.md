1.we need some better language fonts for each language we cover through the i18n
we need good font for persian , arabic, english(sounds more medical font like), france and italy. the font must be fit the language.
we this because when you switch to the persian language forexample the font is ugly although we support the language but the font is not cool

-------------------------

2.remove the before you go urgent reminder modal entirly its noisy.

-------------------------

3.for more clean up things for now disable the support ticket also along the support chat.. remove both them completly and disable them through the env like what we do for the
ai
for the support section if the user needs some support it can only open some ticket withs ome contct info and our admin gonna get that.
that's it. remove the rest things.

along also removoe this route and service portal completly.
http://localhost:5175/service
remove this route along is ui components and backend related code for it completly.



-------------------------


4.profile section
    only in the web responsive in the large screens center all the things to the center not right
    its good on the mobile but in the large screens all is float to left.
---------------------------------


5. http://localhost:5175/evidence
    remove this route nd ui components and backend codes related to it completlyl
    dont break other things.

6.fully remove http://localhost:5175/financing
the ui components related to it along backend code related for it. we dont need it.

7.confirm working on all the browser incliude safari, chrome, firefox.

8.login and singup are not the sam ui. make the signup or create account same as login.

9.404 number in the 404 page is not place the center.

10.blog section that covers markdown and can be write down by teh admin for posting various blogs.

11.in the footer sectoin remove the followings : lease rent to own that leads to financing route remove that
certifid pre own http://localhost:5175/financing#trade-in
paitient leads section and remove complete http://localhost:5175/leads this route and related code both in front and backend for it.

remove the training academoy http://localhost:5175/service#academy
manual videos.
spare parts.
warranty by serial
verify a certificate
so remove the service portal and the mentioned routes and and links completly from the footer.

12.we have white space after footer foter is the last thing we have must not we scrollabele

13.seo handling for pages products and main page  along use of catalog for seo ...



admin page fixes. :
14.if you add a product in the admin page :  you must see that product in the product page also.
remove these things from the admin also :
along when you create the product you also need to configure the lease data for it that we later show in the lease options.

in the admin section remove the messages

in the admin section the blog section is good must handle markdown.. markdown rendering and publish
and when publish must also get seoed and along user see that in the main app blog sectoin.

remove the live chat comletly both from the admin and web app

in the people section remove the leads..

remove the deposite and withdrawl.s

also we need to see all the user network in the people section per each user if they have any network.


also each admin roles can have different set of privilages

we have a root admin : that have access to all the things to the control room

we have money sectoin admin
people sectoiin admin.
content section admin

or can have admin that at the same time can be admin of money section , peole secton and content section.

and we an have multiple root admins..


only the root admin can define the roles of other types of admins..


fix.
in the produdct page like example http://localhost:5175/devices/elysion
there is a ask a question remove that .

in the lease configuraro the user can also choose between other optoins. for now 24 month is hardcodeded

remove teh inactive preapproval.

if the user wants some custom optoins lease it must request its proforma on that and send to us.
so remove the clinic name and phone .. also remoe the send this lease to the whatsapp.
also remove the reserve for 1% secton


