// Moldmaker flange wedge-clip. Profile in XY, extruded T. Print flat, PETG, no supports.
// X = into flange (from flange outer edge), Y = stack direction (bottom half -> top half).
flange_t=5; slot=8.3; clr=0.2;   // flange per half, through slot, clearance per side
slot_edge=4;                      // flange outer edge -> slot edge
taper=5; wedgeL=22; wedge_tip=1.6;
back=6; arm=5; R=2;
part="all";                       // all | frame | wedge | assembly
lugw=slot-0.7;                    // 7.6 (team spec: 0.35/side in slot)
T=lugw;                           // extrusion = lug width
stack=2*flange_t;
wedge_mid=wedge_tip+wedgeL/2*tan(taper);
open=stack+2*clr+wedge_mid;       // U opening
reachX=slot_edge+slot+4;          // arms reach past the slot
lug_h=flange_t-1;                 // lug enters bottom flange slot
lug_x=back+slot_edge+(slot-lugw)/2;
module frame2d(){
  offset(r=-R) offset(r=R) union(){
    square([back,open+2*arm]);                          // back
    square([back+reachX,arm]);                          // bottom arm
    translate([0,arm+open]) square([back+reachX,arm]);  // top arm
    translate([lug_x,arm-0.01]) square([lugw,lug_h]);   // lug into slot
  }
  translate([lug_x+lugw,arm+lug_h-0.8]) circle(0.4,$fn=16);  // tip detent 0.4
  translate([lug_x,arm+lug_h-0.8]) circle(0.4,$fn=16);
}
module wedge2d(){
  w1=wedge_tip+wedgeL*tan(taper);
  polygon([[0,0],[wedgeL,0],[wedgeL,wedge_tip],[0,w1]]);  // thick end out (x=0)
  for(x=[3:2.5:wedgeL-3]) translate([x,0]) polygon([[0,0],[1.2,0],[1.2,-0.35]]); // ratchet teeth (bottom)
  translate([-9,0]) difference(){square([9,w1+4]); translate([4.5,(w1+4)/2]) circle(1.8,$fn=24);} // pull tab
}
if(part=="frame") linear_extrude(T) frame2d();
else if(part=="wedge") linear_extrude(T) wedge2d();
else if(part=="assembly"){ linear_extrude(T) frame2d();
  color("red") translate([back+reachX+9-wedgeL-2,arm+open-wedge_mid-0.05,0]) mirror([1,0]) translate([-wedgeL,0]) linear_extrude(T) wedge2d();
  %translate([back,arm+clr,-5]) difference(){cube([40,stack,T+10]); translate([slot_edge,-1,(T+10-slot)/2]) cube([slot,stack+2,slot]);}}
else { linear_extrude(T) frame2d(); translate([0,-15,0]) linear_extrude(T) wedge2d(); }
echo(open=open, H=open+2*arm, L=back+reachX, T=T, lugw=lugw, lug_h=lug_h, wedge_thick=wedge_tip+wedgeL*tan(taper));
