import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Anotacion } from './anotacion';

describe('Anotacion', () => {
  let component: Anotacion;
  let fixture: ComponentFixture<Anotacion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Anotacion]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Anotacion);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
