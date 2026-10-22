// Moldmaker wedge U-clip — parametric. Print flat (Z = slot height), PETG.
// back spine 6 mm (>=5), arms 5 mm (>=4), inner corners R2, wedge 5 deg self-locking
slot=8; clr=0.2;            // app clampSlot; lug = slot-2*clr = 7.6
slot_depth=1.65;            // app: min(wall*0.55, wall-0.9) @ wall 3
boxD=60;                    // outer box depth (Y in app), between the 2 slot faces
reach=14;                   // arm length from spine to lug centre
part="all";                 // all | frame | jaw | wedge | assembly
lug=slot-2*clr; T=lug;      // part thickness = lug height
arm=5; spine=6; taper=5; wedgeL=30; wedgeW0=3;
gapW=wedgeW0+wedgeL*tan(taper)+0.6; jawW=4;
L=boxD+2*arm+jawW+gapW;
module frame(){
  linear_extrude(T) offset(r=-2) offset(r=2) difference(){
    union(){
      translate([-arm,-spine]) square([L,spine]);
      translate([-arm,0]) square([arm,reach+lug/2]);            // fixed arm
      translate([boxD+jawW+gapW,0]) square([arm,reach+lug/2]);  // outer arm
      translate([0,reach-lug/2]) square([slot_depth-0.25,lug]); // lug
      translate([slot_depth-0.25,reach+lug/2-0.6]) circle(0.4,$fn=16); // 0.4 detent bump at tip
      for(x=[-arm,boxD+jawW+gapW]) translate([x+arm/2,0]) circle(3); // root fillets / ribs
    }
  }
}
module jaw(){ linear_extrude(T) union(){
  square([jawW,reach+lug/2]);
  translate([-(slot_depth-0.25),reach-lug/2]) square([slot_depth-0.25,lug]);
  translate([-(slot_depth-0.25),reach+lug/2-0.6]) circle(0.4,$fn=16);}} // detent bump
module wedge(){ linear_extrude(T) union(){
  polygon([[0,0],[wedgeW0+wedgeL*tan(taper),0],[wedgeW0,wedgeL],[0,wedgeL]]);
  for(y=[6:3:24]) translate([0,y]) polygon([[0,0],[-0.35,0.6],[0,1.2]]);   // ratchet teeth vs jaw
  translate([-1,-8]) difference(){square([wedgeW0+wedgeL*tan(taper)+2,8]); translate([(wedgeW0+wedgeL*tan(taper)+2)/2,3.5]) circle(1.8,$fn=24);} // pull tab
}}
if(part=="frame") frame();
else if(part=="jaw") jaw();
else if(part=="wedge") wedge();
else if(part=="assembly"){ frame(); color("orange") translate([boxD,0,0]) jaw();
  color("red") translate([boxD+jawW,1,0]) wedge();
  %translate([0,-2,-10]) cube([boxD,reach+20,30]); }
else { frame(); translate([0,-spine-25,0]) jaw(); translate([20,-spine-40,0]) wedge(); }
